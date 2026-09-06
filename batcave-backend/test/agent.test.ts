import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { ERRORS } from '../src/errors';
import { onError } from '../src/index';
import { createChatRoute } from '../src/routes/chat';
import { insertTask } from '../src/db/tasks';
import { TaskService } from '../src/services/taskService';
import type { Env, Task } from '../src/types/task';
import { send, startChat } from './helpers/chat';
import { resetDb } from './helpers/reset';
import { ScriptedModel, type ScriptStep } from './helpers/scriptedModel';

beforeEach(resetDb);

/**
 * The real route and the real error handler, with only the model replaced.
 * Everything else — checkpointer, tools, middleware, run rows — is production
 * code running against local D1.
 */
function appWith(script: ScriptStep[]) {
  const model = new ScriptedModel(script);
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/chats', createChatRoute({ model }));
  app.onError(onError);
  return { app, model };
}

/** Starts a fresh conversation unless one is handed in to continue. */
async function chat(app: Hono<{ Bindings: Env }>, message: string, chatId?: string) {
  return send(app, chatId ?? (await startChat()).chatId, message);
}

const seed = (row: Partial<Task> & { title: string }) =>
  insertTask(env.DB, {
    id: crypto.randomUUID(),
    description: null,
    status: 'todo',
    priority: 'medium',
    due_date: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...row,
  });

describe('the loop', () => {
  it('answers without calling a tool', async () => {
    const { app } = appWith([{ text: 'Cloudflare is a CDN, among other things.' }]);
    const { status, body } = await chat(app, 'Is Cloudflare a CDN?');

    expect(status).toBe(200);
    expect(body.reply).toBe('Cloudflare is a CDN, among other things.');
    expect(body.actions).toEqual([]);
    expect(body.chat.id).toBeTruthy();
  });

  it('creates a task and reports it as an action', async () => {
    const { app } = appWith([
      {
        toolCalls: [
          {
            name: 'create_task',
            args: { title: 'Renew the domain', due_date: '2026-09-11', priority: 'high' },
            id: 'call_1',
          },
        ],
      },
      { text: 'Added "Renew the domain", due 11 September.' },
    ]);

    const { status, body } = await chat(app, 'Add a task to renew the domain by Friday');

    expect(status).toBe(200);
    expect(body.reply).toContain('Renew the domain');
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0]).toMatchObject({ tool: 'create_task', ok: true });

    const { tasks } = await new TaskService(env.DB).search({});
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'Renew the domain', priority: 'high' });
  });

  it('searches then updates in one turn', async () => {
    const task = await seed({ title: 'Finish Cloudflare assignment' });
    const { app } = appWith([
      { toolCalls: [{ name: 'search_tasks', args: { query: 'Cloudflare' }, id: 'call_1' }] },
      { toolCalls: [{ name: 'update_task', args: { id: task.id, status: 'done' }, id: 'call_2' }] },
      { text: 'Marked "Finish Cloudflare assignment" as done.' },
    ]);

    const { body } = await chat(app, 'Mark the Cloudflare assignment as done');

    expect(body.actions.map((action) => action.tool)).toEqual(['search_tasks', 'update_task']);
    expect(body.actions.every((action) => action.ok)).toBe(true);
    expect((await new TaskService(env.DB).getById(task.id))?.status).toBe('done');
  });

  it('gives the model each task\'s schedule, and the filter to ask only for scheduled ones', async () => {
    const reminded = await seed({ title: 'Renew the domain' });
    await seed({ title: 'Buy milk' });
    // Written straight to D1: the tool reads the row, and a real schedule would
    // also start a workflow instance this test has no use for.
    await env.DB.prepare(
      `INSERT INTO schedules
         (id, task_id, kind, cron, next_at, status, notification_count, created_at, ended_at)
       VALUES (?, ?, 'recurring', '0 9 * * 1', '2026-09-07T09:00:00.000Z', 'active', 0, ?, NULL)`,
    )
      .bind(crypto.randomUUID(), reminded.id, '2026-09-06T00:00:00.000Z')
      .run();

    const { app } = appWith([
      { toolCalls: [{ name: 'search_tasks', args: { scheduled: true }, id: 'call_1' }] },
      { text: 'You are reminded about "Renew the domain" every Monday at 09:00 UTC.' },
    ]);

    const { body } = await chat(app, 'What are my scheduled tasks?');
    const [search] = body.actions;

    expect(search).toMatchObject({ tool: 'search_tasks', ok: true });
    expect(search!.tasks).toHaveLength(1);
    expect(search!.tasks![0]).toMatchObject({
      title: 'Renew the domain',
      schedule: { kind: 'recurring', cron: '0 9 * * 1', next_at: '2026-09-07T09:00:00.000Z' },
    });
  });

  it('reports an unscheduled task as schedule null rather than leaving it out', async () => {
    await seed({ title: 'Buy milk' });
    const { app } = appWith([
      { toolCalls: [{ name: 'search_tasks', args: {}, id: 'call_1' }] },
      { text: 'Nothing is scheduled.' },
    ]);

    const { body } = await chat(app, 'Anything scheduled?');
    expect(body.actions[0]!.tasks![0]).toMatchObject({ title: 'Buy milk', schedule: null });
  });

  it('remembers a search from the previous turn', async () => {
    const task = await seed({ title: 'Build the backend API' });
    const { app } = appWith([
      { toolCalls: [{ name: 'search_tasks', args: { query: 'backend' }, id: 'call_1' }] },
      { text: 'I found 1 unfinished task:\n1. Build the backend API' },
      // Second turn: the id was never repeated by the user, only seen above.
      { toolCalls: [{ name: 'update_task', args: { id: task.id, status: 'done' }, id: 'call_2' }] },
      { text: 'Marked "Build the backend API" as done.' },
    ]);

    const first = await chat(app, 'Show me my backend tasks');
    const second = await chat(app, 'Mark the first one as done', first.body.chat.id);

    expect(second.body.actions).toEqual([
      expect.objectContaining({ tool: 'update_task', ok: true }),
    ]);
    expect((await new TaskService(env.DB).getById(task.id))?.status).toBe('done');
  });

  it('gives each conversation its own memory', async () => {
    const task = await seed({ title: 'Build the backend API' });
    const { app } = appWith([
      { toolCalls: [{ name: 'search_tasks', args: { query: 'backend' }, id: 'call_1' }] },
      { text: 'I found 1 unfinished task:\n1. Build the backend API' },
      { toolCalls: [{ name: 'update_task', args: { id: task.id, status: 'done' }, id: 'call_2' }] },
      { text: 'Marked it done.' },
    ]);

    await chat(app, 'Show me my backend tasks');
    // A different thread has not seen that search, so the id is not usable.
    const other = await chat(app, 'Mark the first one as done');

    expect(other.body.actions[0]).toMatchObject({
      tool: 'update_task',
      ok: false,
      error: ERRORS.AGENT_TASK_ID_NOT_SEEN,
    });
    expect((await new TaskService(env.DB).getById(task.id))?.status).toBe('todo');
  });
});

describe('the id guard', () => {
  it('refuses an id the model has not seen, and lets it recover', async () => {
    const task = await seed({ title: 'Finish Cloudflare assignment' });
    const { app } = appWith([
      // Straight to the update, no search first.
      { toolCalls: [{ name: 'update_task', args: { id: task.id, status: 'done' }, id: 'call_1' }] },
      { toolCalls: [{ name: 'search_tasks', args: { query: 'Cloudflare' }, id: 'call_2' }] },
      { toolCalls: [{ name: 'update_task', args: { id: task.id, status: 'done' }, id: 'call_3' }] },
      { text: 'Marked "Finish Cloudflare assignment" as done.' },
    ]);

    const { body } = await chat(app, 'Mark the Cloudflare assignment as done');

    expect(body.actions.map((action) => [action.tool, action.ok])).toEqual([
      ['update_task', false],
      ['search_tasks', true],
      ['update_task', true],
    ]);
    expect(body.actions[0]!.error).toBe(ERRORS.AGENT_TASK_ID_NOT_SEEN);
    expect((await new TaskService(env.DB).getById(task.id))?.status).toBe('done');
  });

  it('refuses an id the model invented', async () => {
    const { app } = appWith([
      {
        toolCalls: [
          { name: 'update_task', args: { id: crypto.randomUUID(), status: 'done' }, id: 'call_1' },
        ],
      },
      { text: 'I could not find that task.' },
    ]);

    const { body } = await chat(app, 'Mark the invoice task as done');
    expect(body.actions[0]).toMatchObject({ ok: false, error: ERRORS.AGENT_TASK_ID_NOT_SEEN });
  });
});

describe('bounds', () => {
  it('stops at the round limit and still reports what ran', async () => {
    // The last step repeats, so the model never stops calling the tool.
    const { app } = appWith([
      { toolCalls: [{ name: 'search_tasks', args: { query: 'anything' }, id: 'call_loop' }] },
    ]);

    const { status, body } = await chat(app, 'Search forever');

    expect(status).toBe(200);
    expect(body.reply).toBe(ERRORS.AGENT_TOO_MANY_STEPS);
    expect(body.actions.length).toBeGreaterThan(0);
    expect(body.actions.every((action) => action.tool === 'search_tasks')).toBe(true);
  });

  it('asks the model for one tool call at a time', async () => {
    const { app, model } = appWith([{ text: 'hello' }]);
    await chat(app, 'hi');

    expect(model.bindings[0]).toMatchObject({ parallel_tool_calls: false });
  });
});

describe('tool arguments', () => {
  it('returns a validation failure to the model rather than throwing', async () => {
    const { app } = appWith([
      { toolCalls: [{ name: 'create_task', args: { title: '' }, id: 'call_1' }] },
      { toolCalls: [{ name: 'create_task', args: { title: 'Renew the domain' }, id: 'call_2' }] },
      { text: 'Added "Renew the domain".' },
    ]);

    const { status, body } = await chat(app, 'Add a task');

    expect(status).toBe(200);
    expect(body.actions[0]!.ok).toBe(false);
    expect(body.actions[1]!.ok).toBe(true);
    expect((await new TaskService(env.DB).search({})).tasks).toHaveLength(1);
  });
});

describe('scheduling', () => {
  /** A schedule the agent set, read back from D1 rather than from the reply. */
  const scheduleFor = (taskId: string) =>
    env.DB.prepare(`SELECT * FROM schedules WHERE task_id = ? AND status = 'active'`)
      .bind(taskId)
      .first<Record<string, unknown>>();

  it('finds a task, then schedules a reminder on it', async () => {
    const task = await seed({ title: 'Finish Cloudflare assignment' });
    const remindAt = new Date(Date.now() + 3_600_000).toISOString();

    const { app } = appWith([
      { toolCalls: [{ name: 'search_tasks', args: { query: 'Cloudflare' }, id: 'call_1' }] },
      {
        toolCalls: [
          { name: 'schedule_reminder', args: { id: task.id, remind_at: remindAt }, id: 'call_2' },
        ],
      },
      { text: 'I will remind you about "Finish Cloudflare assignment" in an hour.' },
    ]);

    const { status, body } = await chat(app, 'Remind me about the Cloudflare assignment in an hour');

    expect(status).toBe(200);
    expect(body.actions.map((action) => action.tool)).toEqual([
      'search_tasks',
      'schedule_reminder',
    ]);

    // The task travels inside the schedule, never beside it: a top-level `task`
    // would tell the client the agent rewrote the record, which it did not.
    const action = body.actions[1]!;
    expect(action.ok).toBe(true);
    expect(action.task).toBeUndefined();
    expect(action.schedule).toMatchObject({
      kind: 'once',
      next_at: remindAt,
      status: 'active',
      task: { id: task.id, title: 'Finish Cloudflare assignment' },
    });

    expect(await scheduleFor(task.id)).toMatchObject({ kind: 'once', next_at: remindAt });
  });

  it('schedules a recurring notification from a cron', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { app } = appWith([
      { toolCalls: [{ name: 'search_tasks', args: { query: 'plants' }, id: 'call_1' }] },
      {
        toolCalls: [
          { name: 'schedule_recurring', args: { id: task.id, cron: '0 9 * * 1' }, id: 'call_2' },
        ],
      },
      { text: 'Every Monday at 09:00 UTC.' },
    ]);

    const { body } = await chat(app, 'Remind me to water the plants every Monday at 9');

    expect(body.actions[1]).toMatchObject({ tool: 'schedule_recurring', ok: true });
    expect(await scheduleFor(task.id)).toMatchObject({
      kind: 'recurring',
      cron: '0 9 * * 1',
    });
  });

  it('hands a bad cron back to the model, which corrects it', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { app } = appWith([
      { toolCalls: [{ name: 'search_tasks', args: { query: 'plants' }, id: 'call_1' }] },
      {
        toolCalls: [
          { name: 'schedule_recurring', args: { id: task.id, cron: '* * * * *' }, id: 'call_2' },
        ],
      },
      {
        toolCalls: [
          { name: 'schedule_recurring', args: { id: task.id, cron: '0 9 * * 1' }, id: 'call_3' },
        ],
      },
      { text: 'Set for Mondays at 09:00 UTC.' },
    ]);

    const { status, body } = await chat(app, 'Water the plants every minute');

    // A frequency the service refuses is the model's to fix, so the turn
    // continues rather than failing.
    expect(status).toBe(200);
    expect(body.actions.map((action) => [action.tool, action.ok])).toEqual([
      ['search_tasks', true],
      ['schedule_recurring', false],
      ['schedule_recurring', true],
    ]);
    expect(body.actions[1]!.error).toBe(ERRORS.SCHEDULE_CRON_TOO_FREQUENT);
    expect(await scheduleFor(task.id)).toMatchObject({ cron: '0 9 * * 1' });
  });

  it('reports the schedule a new one replaced', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { app } = appWith([
      { toolCalls: [{ name: 'search_tasks', args: { query: 'plants' }, id: 'call_1' }] },
      {
        toolCalls: [
          { name: 'schedule_recurring', args: { id: task.id, cron: '0 9 * * 1' }, id: 'call_2' },
        ],
      },
      { text: 'Mondays it is.' },
      {
        toolCalls: [
          { name: 'schedule_recurring', args: { id: task.id, cron: '0 9 * * 5' }, id: 'call_3' },
        ],
      },
      { text: 'Moved it to Fridays.' },
    ]);

    const first = await chat(app, 'Water the plants every Monday');
    const second = await chat(app, 'Make that Fridays', first.body.chat.id);

    expect(second.body.actions[0]!.schedule).toMatchObject({ cron: '0 9 * * 5' });
    expect((second.body.actions[0] as { replaced?: unknown }).replaced).toBeUndefined();

    // One active schedule survives the replacement.
    const { results } = await env.DB.prepare(
      `SELECT cron FROM schedules WHERE status = 'active'`,
    ).all();
    expect(results).toEqual([{ cron: '0 9 * * 5' }]);
  });

  it('cancels a schedule', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { app } = appWith([
      { toolCalls: [{ name: 'search_tasks', args: { query: 'plants' }, id: 'call_1' }] },
      {
        toolCalls: [
          { name: 'schedule_recurring', args: { id: task.id, cron: '0 9 * * 1' }, id: 'call_2' },
        ],
      },
      { text: 'Done.' },
      { toolCalls: [{ name: 'cancel_schedule', args: { id: task.id }, id: 'call_3' }] },
      { text: 'Stopped it.' },
    ]);

    const first = await chat(app, 'Water the plants every Monday');
    const second = await chat(app, 'Actually, cancel that', first.body.chat.id);

    expect(second.body.actions[0]).toMatchObject({ tool: 'cancel_schedule', ok: true });
    expect(await scheduleFor(task.id)).toBeNull();
  });

  it('tells the model when there is nothing to cancel', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { app } = appWith([
      { toolCalls: [{ name: 'search_tasks', args: { query: 'plants' }, id: 'call_1' }] },
      { toolCalls: [{ name: 'cancel_schedule', args: { id: task.id }, id: 'call_2' }] },
      { text: 'That task has no reminder set.' },
    ]);

    const { body } = await chat(app, 'Cancel the plants reminder');
    expect(body.actions[1]).toMatchObject({ ok: false, error: ERRORS.SCHEDULE_NOT_FOUND });
  });

  it('refuses to schedule against an id it has not seen', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { app } = appWith([
      {
        toolCalls: [
          {
            name: 'schedule_reminder',
            args: { id: task.id, remind_at: new Date(Date.now() + 3_600_000).toISOString() },
            id: 'call_1',
          },
        ],
      },
      { text: 'Let me find that task first.' },
    ]);

    const { body } = await chat(app, 'Remind me about the plants tomorrow');

    // Scheduling against the wrong row is the same mistake as writing to it.
    expect(body.actions[0]).toMatchObject({
      tool: 'schedule_reminder',
      ok: false,
      error: ERRORS.AGENT_TASK_ID_NOT_SEEN,
    });
    expect(await scheduleFor(task.id)).toBeNull();
  });
});
