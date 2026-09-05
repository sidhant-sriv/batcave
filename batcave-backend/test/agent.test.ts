import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { ERRORS } from '../src/errors';
import { onError } from '../src/index';
import { createChatRoute, type ChatResponse } from '../src/routes/chat';
import { insertTask } from '../src/db/tasks';
import { TaskService } from '../src/services/taskService';
import type { Env, Task } from '../src/types/task';
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
  app.route('/api/chat', createChatRoute({ model }));
  app.onError(onError);
  return { app, model };
}

async function chat(
  app: Hono<{ Bindings: Env }>,
  message: string,
  threadId?: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: ChatResponse & { error?: string } }> {
  const response = await app.request(
    '/api/chat',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ message, ...(threadId ? { thread_id: threadId } : {}) }),
    },
    env,
  );
  return { status: response.status, body: (await response.json()) as ChatResponse };
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
    expect(body.thread_id).toBeTruthy();
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
    const second = await chat(app, 'Mark the first one as done', first.body.thread_id);

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
