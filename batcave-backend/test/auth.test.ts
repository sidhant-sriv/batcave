import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM } from '../src/actor';
import { insertTask } from '../src/db/tasks';
import { ERRORS } from '../src/errors';
import { ScheduleService } from '../src/services/scheduleService';
import { TaskService } from '../src/services/taskService';
import type { Task } from '../src/types/task';
import { OTHER_OWNER, OWNER, api, signIn } from './helpers/auth';
import { pkce } from './helpers/github';
import { callTool } from './helpers/mcp';
import { resetDb } from './helpers/reset';
import { fakeWorkflow } from './helpers/workflow';

/**
 * Who gets in, and what they see once they are in.
 *
 * The second half is the one worth having. Scoping a query is one line and
 * looks obviously right in review; the failure mode is the line that was never
 * added, in the one method nobody thought about. So these cases do not check
 * that a WHERE clause exists — `test/unit/owner.test.ts` does that — they sign
 * two people in and check that neither can reach the other's rows through any
 * surface the app exposes: REST, the schedule and notification lists, and MCP.
 */

beforeEach(resetDb);

const json = async (response: Response) => (await response.json()) as Record<string, any>;

const seed = (owner: string, title: string, over: Partial<Task> = {}) =>
  insertTask(env.DB, {
    id: crypto.randomUUID(),
    user_id: owner,
    title,
    description: null,
    status: 'todo',
    priority: 'medium',
    due_date: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...over,
  });

describe('the door', () => {
  it('turns away a request with no token', async () => {
    const response = await SELF.fetch('https://test/api/tasks');

    expect(response.status).toBe(401);
    expect((await json(response)).error).toBe(ERRORS.UNAUTHORIZED);
  });

  it('turns away a token it did not mint', async () => {
    const response = await SELF.fetch('https://test/api/tasks', {
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    expect(response.status).toBe(401);
    expect((await json(response)).error).toBe(ERRORS.AUTH_TOKEN_INVALID);
  });

  it('lets a signed-in caller through', async () => {
    expect((await api('/api/tasks')).status).toBe(200);
  });

  it('names the caller back to them', async () => {
    const body = await json(await api('/api/auth/me'));
    expect(body.user.login).toBe(OWNER);
  });

  it('guards /me even though its router is mounted ahead of the blanket guard', async () => {
    expect((await SELF.fetch('https://test/api/auth/me')).status).toBe(401);
  });

  /**
   * The mounting order in `createApp` is load-bearing and invisible: move the
   * `app.route('/api/auth', ...)` line below `app.use('/api/*', requireUser)`
   * and the sign-in screen can no longer find out how to sign in.
   */
  it('answers /config without a token, because nothing has one yet', async () => {
    const response = await SELF.fetch('https://test/api/auth/config');
    expect(response.status).toBe(200);

    const body = await json(response);
    expect(body.client_id).toBeTruthy();
    expect(body.authorization_endpoint).toBe('https://test/authorize');
    expect(body.token_endpoint).toBe('https://test/oauth/token');
  });

  /**
   * A preflight carries no Authorization header and never could, so challenging
   * it would make every cross-origin call fail before the real one was sent.
   */
  it('answers a CORS preflight rather than challenging it', async () => {
    const response = await SELF.fetch('https://test/api/tasks', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
  });
});

describe('the first-party client', () => {
  const webClientId = async () => (await json(await SELF.fetch('https://test/api/auth/config'))).client_id as string;

  it('is registered with a redirect URI for every configured origin', async () => {
    const client = await SELF.fetch('https://test/api/auth/config');
    expect((await json(client)).client_id).toBeTruthy();

    // Two origins in wrangler.jsonc, so two callbacks. The authorize endpoint
    // refusing an unregistered redirect_uri is what makes this worth asserting.
    const { challenge } = await pkce();
    for (const origin of ['http://localhost:5173', 'https://batcave-frontend.pages.dev']) {
      const redirect = encodeURIComponent(`${origin}/auth/callback`);
      const response = await SELF.fetch(
        `https://test/authorize?response_type=code&client_id=${await webClientId()}` +
          `&redirect_uri=${redirect}&scope=tasks&state=abc` +
          `&code_challenge=${challenge}&code_challenge_method=S256`,
        { redirect: 'manual' },
      );
      expect(response.status).toBe(302);
    }
  });

  it('skips the consent page and goes straight to GitHub', async () => {
    const { challenge } = await pkce();
    const response = await SELF.fetch(
      `https://test/authorize?response_type=code&client_id=${await webClientId()}` +
        `&redirect_uri=${encodeURIComponent('http://localhost:5173/auth/callback')}` +
        `&scope=tasks&state=abc&code_challenge=${challenge}&code_challenge_method=S256`,
      { redirect: 'manual' },
    );

    expect(response.status).toBe(302);
    expect(new URL(response.headers.get('location')!).origin).toBe('https://github.com');

    // The state binding survives the shortcut. Skipping consent must not mean
    // skipping the cookie the callback checks.
    expect(response.headers.getSetCookie().join(' ')).toContain('state');
  });

  it('still shows the page to a client it did not issue', async () => {
    // `signIn` registers a third-party client and drives the consent page; it
    // would throw looking for the nonce if that page had been skipped.
    await expect(signIn(OWNER)).resolves.toBeTruthy();
  });
});

describe('two people, one deployment', () => {
  it('shows each of them only their own tasks', async () => {
    await seed(OWNER, 'Renew the domain');
    await seed(OTHER_OWNER, 'Feed the cat');

    const mine = await json(await api('/api/tasks'));
    const theirs = await json(await api('/api/tasks', {}, OTHER_OWNER));

    expect(mine.tasks.map((task: Task) => task.title)).toEqual(['Renew the domain']);
    expect(theirs.tasks.map((task: Task) => task.title)).toEqual(['Feed the cat']);
  });

  /**
   * 404 rather than 403 throughout. A 403 confirms the id exists, which is the
   * one thing the other person's account should not be able to tell you.
   */
  it('reports the other one’s task as missing rather than forbidden', async () => {
    const theirs = await seed(OTHER_OWNER, 'Feed the cat');

    const read = await api(`/api/tasks/${theirs.id}`);
    expect(read.status).toBe(404);
    expect((await json(read)).error).toBe(ERRORS.TASK_NOT_FOUND);

    const written = await api(`/api/tasks/${theirs.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(written.status).toBe(404);
  });

  it('leaves the task it refused to update exactly as it was', async () => {
    const theirs = await seed(OTHER_OWNER, 'Feed the cat');

    await api(`/api/tasks/${theirs.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Rewritten' }),
    });

    const row = await new TaskService(env.DB, OTHER_OWNER).getById(theirs.id);
    expect(row?.title).toBe('Feed the cat');
    expect(row?.status).toBe('todo');
  });

  it('hides a schedule and its notifications, which own no login of their own', async () => {
    const theirs = await seed(OTHER_OWNER, 'Feed the cat');
    const schedules = new ScheduleService(env.DB, fakeWorkflow(), OTHER_OWNER);
    const { schedule } = await schedules.scheduleOnce(theirs.id, {
      remind_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await schedules.notify(schedule.id, 1);

    expect((await json(await api('/api/schedules'))).schedules).toEqual([]);
    expect((await json(await api('/api/notifications'))).notifications).toEqual([]);

    // And the owner does see them, so the empty lists above are scoping rather
    // than a query that returns nothing for everybody.
    const owned = await json(await api('/api/schedules', {}, OTHER_OWNER));
    expect(owned.schedules).toHaveLength(1);
  });

  it('refuses to cancel a schedule that is not the caller’s', async () => {
    const theirs = await seed(OTHER_OWNER, 'Feed the cat');
    const schedules = new ScheduleService(env.DB, fakeWorkflow(), OTHER_OWNER);
    const { schedule } = await schedules.scheduleOnce(theirs.id, {
      remind_at: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const response = await api(`/api/schedules/${schedule.id}`, { method: 'DELETE' });
    expect(response.status).toBe(404);

    const still = await new ScheduleService(env.DB, fakeWorkflow(), OTHER_OWNER).listSchedules({});
    expect(still.schedules[0]?.status).toBe('active');
  });

  it('keeps conversations apart too', async () => {
    const created = await api('/api/chats', { method: 'POST' });
    const { chat } = await json(created);

    expect((await json(await api('/api/chats'))).chats).toHaveLength(1);
    expect((await json(await api('/api/chats', {}, OTHER_OWNER))).chats).toEqual([]);

    const read = await api(`/api/chats/${chat.id}`, {}, OTHER_OWNER);
    expect(read.status).toBe(404);
  });

  it('scopes the MCP surface by the login on the grant', async () => {
    await seed(OWNER, 'Renew the domain');
    await seed(OTHER_OWNER, 'Feed the cat');

    const mine = await callTool('search_tasks', {}, { props: { login: OWNER, name: null } });
    const theirs = await callTool(
      'search_tasks',
      {},
      { props: { login: OTHER_OWNER, name: null } },
    );

    expect(mine.payload.tasks.map((task: Task) => task.title)).toEqual(['Renew the domain']);
    expect(theirs.payload.tasks.map((task: Task) => task.title)).toEqual(['Feed the cat']);
  });
});

describe('the Workflow, which acts for nobody', () => {
  it('reaches a schedule no request-scoped service would find', async () => {
    const theirs = await seed(OTHER_OWNER, 'Feed the cat');
    const { schedule } = await new ScheduleService(
      env.DB,
      fakeWorkflow(),
      OTHER_OWNER,
    ).scheduleOnce(theirs.id, { remind_at: new Date(Date.now() + 3_600_000).toISOString() });

    // This is the clock: the instance was started for someone, woke on its own,
    // and has no request to carry a login on.
    const asSystem = new ScheduleService(env.DB, fakeWorkflow(), SYSTEM);
    expect(await asSystem.plan(schedule.id)).toMatchObject({ stop: false });

    // The same call scoped to the wrong person finds nothing, which is what
    // makes the line above a statement about SYSTEM rather than about the row.
    const asStranger = new ScheduleService(env.DB, fakeWorkflow(), OWNER);
    expect(await asStranger.plan(schedule.id)).toEqual({ stop: true });
  });
});
