import type { BaseMessage } from '@langchain/core/messages';
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildAgent, threadConfig } from '../src/agent/agent';
import { RUN_TTL_SECONDS, claim, runKey } from '../src/agent/runs';
import { selectRun } from '../src/db/agentState';
import { ERRORS } from '../src/errors';
import { onError } from '../src/index';
import { createChatRoute } from '../src/routes/chat';
import { TaskService } from '../src/services/taskService';
import { dbFailingOn, dbLosingWriteAfterInsert } from './helpers/db';
import type { Env } from '../src/types/task';
import { send, startChat } from './helpers/chat';
import { resetDb } from './helpers/reset';
import { ScriptedModel, type ScriptStep } from './helpers/scriptedModel';

beforeEach(resetDb);

function appWith(script: ScriptStep[]) {
  const model = new ScriptedModel(script);
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/chats', createChatRoute({ model }));
  app.onError(onError);
  return { app, model };
}

/** `key` fixes the run key, so a retry is recognisable no matter what the
 *  thread's checkpoint did in between. */
async function chat(
  app: Hono<{ Bindings: Env }>,
  options: { chatId: string; message: string; key?: string; bindings?: Partial<Env> },
) {
  return send(app, options.chatId, options.message, {
    key: options.key,
    bindings: options.bindings,
  });
}

const createStep = (title: string, id = 'call_1'): ScriptStep => ({
  toolCalls: [{ name: 'create_task', args: { title }, id }],
});

const threadState = (threadId: string) =>
  buildAgent(env).graph.getState(threadConfig(threadId));

const runFor = async (threadId: string, message: string, key?: string) =>
  selectRun(env.DB, await runKey({ header: key, threadId, message, checkpointId: null }));

describe('claiming a run', () => {
  const params = (overrides: Partial<Parameters<typeof claim>[1]> = {}) => ({
    key: 'run-key',
    threadId: 'thread-1',
    message: 'hello',
    startCheckpointId: null,
    ...overrides,
  });

  it('claims a key nobody holds', async () => {
    const result = await claim(env.DB, params());
    expect(result.kind).toBe('claimed');
  });

  it('refuses a second claim while the first is inside its TTL', async () => {
    await claim(env.DB, params());
    expect((await claim(env.DB, params())).kind).toBe('busy');
  });

  it('replays a completed run instead of re-running it', async () => {
    await claim(env.DB, params());
    await env.DB.prepare(
      `UPDATE agent_runs SET status = 'completed', response = ? WHERE run_key = 'run-key'`,
    )
      .bind(JSON.stringify({ reply: 'done' }))
      .run();

    const result = await claim(env.DB, params());
    expect(result).toMatchObject({ kind: 'replay', response: { reply: 'done' } });
  });

  it('takes over a failed run', async () => {
    await claim(env.DB, params());
    await env.DB.prepare(`UPDATE agent_runs SET status = 'failed' WHERE run_key = 'run-key'`).run();

    expect((await claim(env.DB, params())).kind).toBe('takeover');
  });

  it('takes over a running run that outlived its TTL', async () => {
    await claim(env.DB, params());
    await env.DB.prepare(`UPDATE agent_runs SET started_at = ? WHERE run_key = 'run-key'`)
      .bind(Math.floor(Date.now() / 1000) - RUN_TTL_SECONDS - 1)
      .run();

    expect((await claim(env.DB, params())).kind).toBe('takeover');
  });

  it('keeps the checkpoint the run first started from', async () => {
    await claim(env.DB, params({ startCheckpointId: 'checkpoint-a' }));
    await env.DB.prepare(`UPDATE agent_runs SET status = 'failed' WHERE run_key = 'run-key'`).run();

    // A takeover must compare against where the *first* attempt started, so
    // this is deliberately not overwritten with the current checkpoint.
    const result = await claim(env.DB, params({ startCheckpointId: 'checkpoint-b' }));
    expect(result).toMatchObject({ kind: 'takeover', row: { start_checkpoint_id: 'checkpoint-a' } });
  });
});

describe('idempotency at the route', () => {
  it('replays a completed turn without calling the model again', async () => {
    const { app, model } = appWith([{ text: 'Cloudflare is a CDN.' }]);

    const { chatId } = await startChat();

    const first = await chat(app, { chatId, message: 'Is Cloudflare a CDN?', key: 'retry-me' });
    const cursorAfterFirst = model.shared.cursor.current;
    const second = await chat(app, { chatId, message: 'Is Cloudflare a CDN?', key: 'retry-me' });

    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(model.shared.cursor.current).toBe(cursorAfterFirst);
  });

  it('refuses a second turn while one is still running on the thread', async () => {
    const { app } = appWith([{ text: 'hello' }]);
    const { chatId, threadId } = await startChat();

    // A run row left behind by a request that is still in flight.
    await claim(env.DB, {
      key: await runKey({ header: 'in-flight', threadId, message: 'hi', checkpointId: null }),
      threadId,
      message: 'hi',
      startCheckpointId: null,
    });

    const { status, body } = await chat(app, { chatId, message: 'hi', key: 'in-flight' });
    expect(status).toBe(409);
    expect(body.error).toBe(ERRORS.THREAD_BUSY);
  });
});

describe('a tool that cannot reach D1', () => {
  it('fails the request instead of apologising to the user with a 200', async () => {
    const { app } = appWith([createStep('Renew the domain'), { text: 'Added it.' }]);
    const { chatId, threadId } = await startChat();

    const { status, body } = await chat(app, {
      chatId,
      message: 'Add a task to renew the domain',
      key: 'infra',
      bindings: { DB: dbFailingOn(env.DB, 'INSERT INTO tasks') },
    });

    expect(status).toBe(503);
    expect(body.error).toBe(ERRORS.AGENT_UNAVAILABLE);
    expect((await runFor(threadId, 'x', 'infra'))?.status).toBe('failed');
  });

  it('leaves the turn resumable, with the tool call still pending', async () => {
    const { app } = appWith([createStep('Renew the domain'), { text: 'Added it.' }]);
    const { chatId, threadId } = await startChat();

    await chat(app, {
      chatId,
      message: 'Add a task to renew the domain',
      key: 'infra',
      bindings: { DB: dbFailingOn(env.DB, 'INSERT INTO tasks') },
    });

    expect((await threadState(threadId)).next).toEqual(['tools']);
  });

  it('is retried by the next request on the thread, creating exactly one task', async () => {
    const { app } = appWith([createStep('Renew the domain'), { text: 'Added it.' }]);
    const { chatId, threadId } = await startChat();

    await chat(app, {
      chatId,
      message: 'Add a task to renew the domain',
      key: 'infra',
      bindings: { DB: dbFailingOn(env.DB, 'INSERT INTO tasks') },
    });

    const retry = await chat(app, {
      chatId,
      message: 'Add a task to renew the domain',
      key: 'infra',
    });

    expect(retry.status).toBe(200);
    expect(retry.body.actions).toEqual([expect.objectContaining({ tool: 'create_task', ok: true })]);
    expect((await runFor(threadId, 'x', 'infra'))?.status).toBe('completed');

    const { tasks } = await new TaskService(env.DB).search({});
    expect(tasks).toHaveLength(1);
  });
});

describe('a tool that committed but whose result was never recorded', () => {
  it('re-runs on resume and upserts the same task rather than duplicating it', async () => {
    const { app } = appWith([createStep('Renew the domain'), { text: 'Added it.' }]);
    const { chatId, threadId } = await startChat();

    // The insert lands; the checkpointer write that would mark the tool call
    // finished does not. This is the one window §7.3 leaves open.
    const failed = await chat(app, {
      chatId,
      message: 'Add a task to renew the domain',
      key: 'lost-write',
      bindings: { DB: dbLosingWriteAfterInsert(env.DB) },
    });

    // 500, not the tool-specific 503: the tool succeeded, and it was the
    // checkpointer that could not reach D1. What matters either way is that the
    // run is marked failed, which is what lets the next request take it over.
    expect(failed.status).toBe(500);
    expect((await runFor(threadId, 'x', 'lost-write'))?.status).toBe('failed');

    const before = await new TaskService(env.DB).search({});
    expect(before.tasks).toHaveLength(1);

    const retry = await chat(app, {
      chatId,
      message: 'Add a task to renew the domain',
      key: 'lost-write',
    });

    expect(retry.status).toBe(200);
    const after = await new TaskService(env.DB).search({});
    expect(after.tasks).toHaveLength(1);
    // Same row, because the id came from the tool call rather than a generator.
    expect(after.tasks[0]!.id).toBe(before.tasks[0]!.id);
  });
});

describe('taking over a turn that had actually finished', () => {
  it('rebuilds the answer without re-running it or duplicating the message', async () => {
    const { app, model } = appWith([{ text: 'Cloudflare is a CDN.' }]);
    const { chatId, threadId } = await startChat();

    const first = await chat(app, { chatId, message: 'Is Cloudflare a CDN?', key: 'orphan' });
    const cursorAfterFirst = model.shared.cursor.current;

    // Exactly what an isolate killed between the last checkpoint and the row
    // update leaves behind: the graph is done, the row still says running, and
    // it started from a thread that had no checkpoint yet.
    await env.DB.prepare(
      `UPDATE agent_runs
          SET status = 'running', response = NULL, ended_at = NULL, started_at = ?
        WHERE thread_id = ?`,
    )
      .bind(Math.floor(Date.now() / 1000) - RUN_TTL_SECONDS - 1, threadId)
      .run();

    const second = await chat(app, { chatId, message: 'Is Cloudflare a CDN?', key: 'orphan' });

    expect(second.status).toBe(200);
    expect(second.body.reply).toBe(first.body.reply);
    expect(model.shared.cursor.current).toBe(cursorAfterFirst);

    const messages = (await threadState(threadId)).values.messages ?? [];
    const asked = messages.filter((message: BaseMessage) => message.getType() === 'human');
    expect(asked).toHaveLength(1);
  });
});

describe('checkpoint pruning', () => {
  it('keeps only the newest few checkpoints per thread', async () => {
    const { app } = appWith([
      createStep('First task', 'call_1'),
      { text: 'Added it.' },
      createStep('Second task', 'call_2'),
      { text: 'Added that too.' },
    ]);

    const { chatId, threadId } = await startChat();

    await chat(app, { chatId, message: 'Add the first task' });
    await chat(app, { chatId, message: 'Add the second task' });

    const { results } = await env.DB.prepare('SELECT * FROM checkpoints WHERE thread_id = ?')
      .bind(threadId)
      .all();
    expect(results.length).toBeLessThanOrEqual(3);
    // Still resumable: the newest checkpoint is intact and the thread is idle.
    expect((await threadState(threadId)).next).toEqual([]);
  });
});
