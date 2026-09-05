import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { ERRORS } from '../src/errors';
import { onError } from '../src/index';
import {
  createChatRoute,
  type ChatResponse,
  type ThreadHistoryResponse,
} from '../src/routes/chat';
import type { Env } from '../src/types/task';
import { dbFailingOn } from './helpers/db';
import { resetDb } from './helpers/reset';
import { ScriptedModel, type ScriptStep } from './helpers/scriptedModel';

beforeEach(resetDb);

function appWith(script: ScriptStep[]) {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/chat', createChatRoute({ model: new ScriptedModel(script) }));
  app.onError(onError);
  return app;
}

async function say(
  app: Hono<{ Bindings: Env }>,
  message: string,
  threadId?: string,
  bindings: Partial<Env> = {},
) {
  const response = await app.request(
    '/api/chat',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, ...(threadId ? { thread_id: threadId } : {}) }),
    },
    { ...env, ...bindings },
  );
  return { status: response.status, body: (await response.json()) as ChatResponse };
}

async function history(
  app: Hono<{ Bindings: Env }>,
  threadId: string,
  bindings: Partial<Env> = {},
) {
  const response = await app.request(`/api/chat/${threadId}`, {}, { ...env, ...bindings });
  return {
    status: response.status,
    body: (await response.json()) as ThreadHistoryResponse & { error?: string },
  };
}

const createStep = (title: string, id: string): ScriptStep => ({
  toolCalls: [{ name: 'create_task', args: { title }, id }],
});

describe('reading a conversation back', () => {
  it('returns every turn in order, with what each one did', async () => {
    const app = appWith([
      createStep('Renew the domain', 'call_1'),
      { text: 'Added "Renew the domain".' },
      { text: 'You have one task.' },
    ]);

    const first = await say(app, 'Add a task to renew the domain');
    await say(app, 'How many do I have?', first.body.thread_id);

    const { status, body } = await history(app, first.body.thread_id);

    expect(status).toBe(200);
    expect(body.thread_id).toBe(first.body.thread_id);
    expect(body.turns).toHaveLength(2);
    expect(body.turns[0]).toMatchObject({
      message: 'Add a task to renew the domain',
      reply: 'Added "Renew the domain".',
    });
    expect(body.turns[0]!.actions).toEqual([
      expect.objectContaining({ tool: 'create_task', ok: true }),
    ]);
    expect(body.turns[1]).toEqual({
      message: 'How many do I have?',
      reply: 'You have one task.',
      actions: [],
    });
  });

  it('gives a turn the same reply and actions the POST did', async () => {
    const app = appWith([createStep('Renew the domain', 'call_1'), { text: 'Added it.' }]);

    const posted = await say(app, 'Add a task to renew the domain');
    const { body } = await history(app, posted.body.thread_id);

    expect(body.turns[0]).toEqual({
      message: 'Add a task to renew the domain',
      reply: posted.body.reply,
      actions: posted.body.actions,
    });
  });

  it('keeps every turn even after older checkpoints are pruned', async () => {
    const app = appWith([
      createStep('First task', 'call_1'),
      { text: 'Added the first.' },
      createStep('Second task', 'call_2'),
      { text: 'Added the second.' },
      { text: 'Two so far.' },
    ]);

    const first = await say(app, 'Add the first task');
    const thread = first.body.thread_id;
    await say(app, 'Add the second task', thread);
    await say(app, 'How many now?', thread);

    const { results } = await env.DB.prepare('SELECT 1 FROM checkpoints WHERE thread_id = ?')
      .bind(thread)
      .all();
    expect(results.length).toBeLessThanOrEqual(3);

    // Pruning drops intermediate snapshots, not history: the newest checkpoint
    // carries the whole message list, which is what MessagesValue accumulates.
    const { body } = await history(app, thread);
    expect(body.turns.map((turn) => turn.message)).toEqual([
      'Add the first task',
      'Add the second task',
      'How many now?',
    ]);
  });

  it('reads a thread whose last turn failed', async () => {
    const app = appWith([createStep('Renew the domain', 'call_1'), { text: 'Added it.' }]);
    const thread = crypto.randomUUID();

    const failed = await say(app, 'Add a task to renew the domain', thread, {
      DB: dbFailingOn(env.DB, 'INSERT INTO tasks'),
    });
    expect(failed.status).toBe(503);

    // The user's message was checkpointed before the tool ran, so the turn is
    // visible even though it never produced a reply.
    const { status, body } = await history(app, thread);
    expect(status).toBe(200);
    expect(body.turns).toEqual([
      { message: 'Add a task to renew the domain', reply: null, actions: [] },
    ]);
  });

  it('needs no model, so it works without a Groq key', async () => {
    const app = appWith([{ text: 'Hello.' }]);
    const posted = await say(app, 'hi');

    const { status, body } = await history(app, posted.body.thread_id, {
      GROQ_API_KEY: undefined,
    });

    expect(status).toBe(200);
    expect(body.turns).toHaveLength(1);
  });
});

describe('when the thread is not there', () => {
  it('is 404 for a thread that never ran', async () => {
    const { status, body } = await history(appWith([{ text: 'hi' }]), crypto.randomUUID());

    expect(status).toBe(404);
    expect(body.error).toBe(ERRORS.THREAD_NOT_FOUND);
  });

  it('is 400 for an id that is not a UUID', async () => {
    const { status, body } = await history(appWith([{ text: 'hi' }]), 'not-a-uuid');

    expect(status).toBe(400);
    expect(body.error).toBe(ERRORS.THREAD_ID_INVALID);
  });
});
