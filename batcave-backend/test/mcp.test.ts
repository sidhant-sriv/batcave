import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertTask } from '../src/db/tasks';
import { ERRORS } from '../src/errors';
import { TaskService } from '../src/services/taskService';
import type { Task } from '../src/types/task';
import { callTool, rpc } from './helpers/mcp';
import { dbFailingOn } from './helpers/db';
import { fakeWorkflow } from './helpers/workflow';
import { OWNER } from './helpers/auth';
import { resetDb } from './helpers/reset';

/**
 * The MCP surface, driven as a client drives it: real JSON-RPC over the real
 * handler, against local D1. Only the OAuth handshake is left out, because it
 * is `test/oauth.test.ts`'s subject.
 *
 * Every case asserts twice where it can — once on what the protocol returned,
 * once on what D1 holds — because a tool that reports success without writing
 * is the failure this surface exists to make impossible.
 */

beforeEach(resetDb);

const service = () => new TaskService(env.DB, OWNER);

/** A week out: comfortably future, and inside the service's one-year horizon. */
const soon = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

/** A workflow that records instead of sleeping for an hour. */
const workflow = () => ({ bindings: { TASK_SCHEDULE: fakeWorkflow() } });

async function seed(rows: Array<Partial<Task> & { title: string }>): Promise<Task[]> {
  const created: Task[] = [];
  for (const [index, row] of rows.entries()) {
    const stamp = `2026-01-0${index + 1}T00:00:00.000Z`;
    created.push(
      await insertTask(env.DB, {
        id: crypto.randomUUID(),
        user_id: OWNER,
        description: null,
        status: 'todo',
        priority: 'medium',
        due_date: null,
        created_at: stamp,
        updated_at: stamp,
        ...row,
      }),
    );
  }
  return created;
}

describe('the tool surface', () => {
  it('advertises the six tools the agent has, and their hints', async () => {
    const { body } = await rpc('tools/list');
    const tools = body.result.tools as Array<Record<string, any>>;

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'cancel_schedule',
      'create_task',
      'schedule_recurring',
      'schedule_reminder',
      'search_tasks',
      'update_task',
    ]);

    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    // The hints are what a client uses to decide whether to ask before running
    // something, so they are part of the contract, not decoration.
    expect(byName.search_tasks!.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.cancel_schedule!.annotations).toMatchObject({ destructiveHint: true });
    expect(byName.create_task!.annotations).toMatchObject({ destructiveHint: false });
  });

  it('carries the argument schema through from the shared definitions', async () => {
    const { body } = await rpc('tools/list');
    const tools = body.result.tools as Array<Record<string, any>>;
    const create = tools.find((tool) => tool.name === 'create_task')!;

    expect(Object.keys(create.inputSchema.properties).sort()).toEqual([
      'description',
      'due_date',
      'priority',
      'title',
    ]);
    expect(create.inputSchema.required).toEqual(['title']);
    // The prose the model reads comes from the same place the agent's does.
    expect(create.description).toContain('due date is only when the work is expected');
  });
});

describe('create_task', () => {
  it('creates a row and returns it', async () => {
    const { isError, payload } = await callTool('create_task', {
      title: 'Renew the domain',
      priority: 'high',
      due_date: '2026-09-11',
    });

    expect(isError).toBe(false);
    expect(payload).toMatchObject({ ok: true, task: { title: 'Renew the domain', priority: 'high' } });

    const { tasks } = await service().search({});
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'Renew the domain', status: 'todo' });
  });

  it('refuses bad arguments without writing anything', async () => {
    // Caught by the advertised schema, before the handler runs at all — which
    // is why the message is the SDK's prose rather than our JSON envelope.
    const { isError, text } = await callTool('create_task', { title: '' });

    expect(isError).toBe(true);
    expect(text).toContain('validation');

    const { tasks } = await service().search({});
    expect(tasks).toHaveLength(0);
  });

  it('refuses a due date that is not a date', async () => {
    const { isError } = await callTool('create_task', {
      title: 'Renew the domain',
      due_date: 'friday',
    });

    expect(isError).toBe(true);
    expect(await service().search({})).toMatchObject({ tasks: [] });
  });

  it('mints its own id rather than deriving one from the request', async () => {
    // Two identical calls are two tasks. A JSON-RPC id is chosen by the client
    // and restarts at 1 each session, so deriving a primary key from it would
    // make unrelated calls collide on one row.
    await callTool('create_task', { title: 'Water the plants' });
    await callTool('create_task', { title: 'Water the plants' });

    const { tasks } = await service().search({});
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.id).not.toBe(tasks[1]!.id);
  });
});

describe('search_tasks', () => {
  beforeEach(async () => {
    await seed([
      { title: 'Renew the domain', priority: 'high', due_date: '2026-09-11' },
      { title: 'Water the plants', status: 'done' },
      { title: 'Write the release notes', status: 'in_progress' },
    ]);
  });

  it('finds by keyword and reports the count', async () => {
    const { payload } = await callTool('search_tasks', { query: 'domain' });

    expect(payload).toMatchObject({ ok: true, count: 1, truncated: false });
    expect(payload.tasks[0]).toMatchObject({ title: 'Renew the domain' });
    // Every result carries its schedule, so one call answers both questions.
    expect(payload.tasks[0]).toHaveProperty('schedule', null);
  });

  it('narrows by status', async () => {
    const { payload } = await callTool('search_tasks', { status: ['done'] });

    expect(payload.count).toBe(1);
    expect(payload.tasks[0]).toMatchObject({ title: 'Water the plants', status: 'done' });
  });

  it('returns an empty result rather than an error when nothing matches', async () => {
    const { isError, payload } = await callTool('search_tasks', { query: 'nothing like this' });

    expect(isError).toBe(false);
    expect(payload).toMatchObject({ ok: true, count: 0, tasks: [] });
  });
});

describe('update_task', () => {
  it('changes only what was sent, and says what moved', async () => {
    const [task] = await seed([{ title: 'Renew the domain' }]);

    const { payload } = await callTool('update_task', { id: task!.id, status: 'done' });

    expect(payload.changed).toEqual(['status']);
    expect(payload.task).toMatchObject({ title: 'Renew the domain', status: 'done' });
  });

  it('refuses an id that is not a task', async () => {
    const { isError, payload } = await callTool('update_task', {
      id: crypto.randomUUID(),
      status: 'done',
    });

    expect(isError).toBe(true);
    expect(payload.error).toBe(ERRORS.TASK_NOT_FOUND);
  });

  it('refuses an update that changes nothing', async () => {
    // The refine that enforces this is dropped when the schema is advertised,
    // so this proves the service still applies it on the way in.
    const [task] = await seed([{ title: 'Renew the domain' }]);

    const { isError, payload } = await callTool('update_task', { id: task!.id });

    expect(isError).toBe(true);
    expect(payload.error).toBe(ERRORS.INVALID_TASK_INPUT);
  });
});

describe('scheduling', () => {
  const active = (taskId: string) =>
    env.DB.prepare(`SELECT * FROM schedules WHERE task_id = ? AND status = 'active'`)
      .bind(taskId)
      .first<Record<string, unknown>>();

  it('sets a one-off reminder', async () => {
    const [task] = await seed([{ title: 'Renew the domain' }]);

    const { payload } = await callTool(
      'schedule_reminder',
      { id: task!.id, remind_at: soon() },
      workflow(),
    );

    expect(payload.schedule).toMatchObject({ kind: 'once', task: { id: task!.id } });
    expect(await active(task!.id)).toMatchObject({ kind: 'once' });
  });

  it('refuses a reminder in the past', async () => {
    const [task] = await seed([{ title: 'Renew the domain' }]);

    const { isError, payload } = await callTool(
      'schedule_reminder',
      { id: task!.id, remind_at: '2020-01-01T09:00:00Z' },
      workflow(),
    );

    expect(isError).toBe(true);
    expect(payload.error).toBe(ERRORS.SCHEDULE_IN_PAST);
    expect(await active(task!.id)).toBeNull();
  });

  it('replaces the schedule a task already had, and reports what it replaced', async () => {
    const [task] = await seed([{ title: 'Water the plants' }]);

    await callTool(
      'schedule_reminder',
      { id: task!.id, remind_at: soon() },
      workflow(),
    );
    const { payload } = await callTool(
      'schedule_recurring',
      { id: task!.id, cron: '0 9 * * 1' },
      workflow(),
    );

    expect(payload.schedule).toMatchObject({ kind: 'recurring', cron: '0 9 * * 1' });
    expect(payload.replaced).toMatchObject({ kind: 'once' });
    expect(await active(task!.id)).toMatchObject({ kind: 'recurring' });
  });

  it('refuses a cron that would fire too often', async () => {
    const [task] = await seed([{ title: 'Water the plants' }]);

    const { isError, payload } = await callTool(
      'schedule_recurring',
      { id: task!.id, cron: '*/5 * * * *' },
      workflow(),
    );

    expect(isError).toBe(true);
    expect(payload.error).toBe(ERRORS.SCHEDULE_CRON_TOO_FREQUENT);
  });

  it('cancels, then refuses to cancel again', async () => {
    const [task] = await seed([{ title: 'Water the plants' }]);
    await callTool('schedule_recurring', { id: task!.id, cron: '0 9 * * 1' }, workflow());

    const cancelled = await callTool('cancel_schedule', { id: task!.id }, workflow());
    expect(cancelled.isError).toBe(false);
    expect(await active(task!.id)).toBeNull();

    const again = await callTool('cancel_schedule', { id: task!.id }, workflow());
    expect(again.isError).toBe(true);
    expect(again.payload.error).toBe(ERRORS.SCHEDULE_NOT_FOUND);
  });
});

describe('resources', () => {
  it('lists the two static resources and the template', async () => {
    const listed = await rpc('resources/list');
    expect(
      (listed.body.result.resources as Array<Record<string, any>>).map((row) => row.uri).sort(),
    ).toEqual(['batcave://schedules/upcoming', 'batcave://tasks/open']);

    const templates = await rpc('resources/templates/list');
    expect(
      (templates.body.result.resourceTemplates as Array<Record<string, any>>).map(
        (row) => row.uriTemplate,
      ),
    ).toEqual(['batcave://tasks/{id}']);
  });

  it('reads the open list, and leaves finished work out of it', async () => {
    await seed([
      { title: 'Renew the domain' },
      { title: 'Water the plants', status: 'done' },
      { title: 'Write the release notes', status: 'in_progress' },
    ]);

    const { body } = await rpc('resources/read', { uri: 'batcave://tasks/open' });
    const contents = body.result.contents[0];

    expect(contents.mimeType).toBe('application/json');
    const payload = JSON.parse(contents.text);
    expect(payload.count).toBe(2);
    expect(payload.tasks.map((task: Task) => task.title).sort()).toEqual([
      'Renew the domain',
      'Write the release notes',
    ]);
  });

  it('reads one task with the schedule attached to it', async () => {
    const [task] = await seed([{ title: 'Water the plants' }]);
    await callTool('schedule_recurring', { id: task!.id, cron: '0 9 * * 1' }, workflow());

    const { body } = await rpc('resources/read', { uri: `batcave://tasks/${task!.id}` });
    const payload = JSON.parse(body.result.contents[0].text);

    expect(payload.task).toMatchObject({ id: task!.id, title: 'Water the plants' });
    expect(payload.schedule).toMatchObject({ kind: 'recurring', cron: '0 9 * * 1' });
  });

  it('answers a missing task with a protocol error, not an empty document', async () => {
    const { body } = await rpc('resources/read', {
      uri: `batcave://tasks/${crypto.randomUUID()}`,
    });

    expect(body.error).toBeDefined();
    expect(body.result).toBeUndefined();
  });
});

describe('when the database is down', () => {
  it('refuses without describing our infrastructure to the caller', async () => {
    const { isError, payload, text } = await callTool(
      'create_task',
      { title: 'Renew the domain' },
      { bindings: { DB: dbFailingOn(env.DB, 'INSERT INTO tasks') } },
    );

    expect(isError).toBe(true);
    expect(payload.error).toBe(ERRORS.MCP_TOOL_UNAVAILABLE);
    // The real cause belongs in the log, not in a message a stranger reads.
    expect(text).not.toContain('D1_UNAVAILABLE');
  });
});
