import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { ERRORS } from '../src/errors';
import { onError } from '../src/index';
import { createChatRoute, type ChatHistoryResponse } from '../src/routes/chat';
import type { AppEnv, Env } from '../src/types/task';
import { asUser } from './helpers/auth';
import { send, startChat } from './helpers/chat';
import { dbFailingOn } from './helpers/db';
import { resetDb } from './helpers/reset';
import { ScriptedModel, type ScriptStep } from './helpers/scriptedModel';

beforeEach(resetDb);

function appWith(script: ScriptStep[]) {
  const app = new Hono<AppEnv>();
  app.use('*', asUser());
  app.route('/api/chats', createChatRoute({ model: new ScriptedModel(script) }));
  app.onError(onError);
  return app;
}

async function history(
  app: Hono<AppEnv>,
  chatId: string,
  bindings: Partial<Env> = {},
) {
  const response = await app.request(`/api/chats/${chatId}`, {}, { ...env, ...bindings });
  return {
    status: response.status,
    body: (await response.json()) as ChatHistoryResponse & { error?: string },
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
    const { chatId } = await startChat();

    await send(app, chatId, 'Add a task to renew the domain');
    await send(app, chatId, 'How many do I have?');

    const { status, body } = await history(app, chatId);

    expect(status).toBe(200);
    expect(body.chat.id).toBe(chatId);
    expect(body.chat.turn_count).toBe(2);
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
    const { chatId } = await startChat();

    const posted = await send(app, chatId, 'Add a task to renew the domain');
    const { body } = await history(app, chatId);

    expect(body.turns[0]).toEqual({
      message: 'Add a task to renew the domain',
      reply: posted.body.reply,
      actions: posted.body.actions,
    });
  });

  it('names the chat after its first message and counts the rest', async () => {
    const app = appWith([{ text: 'Sure.' }, { text: 'Still sure.' }]);
    const { chatId } = await startChat();

    await send(app, chatId, 'Add a task to renew the domain');
    await send(app, chatId, 'And another one');

    const { body } = await history(app, chatId);
    expect(body.chat.title).toBe('Add a task to renew the domain');
    expect(body.chat.turn_count).toBe(2);
  });

  it('keeps every turn even after older checkpoints are pruned', async () => {
    const app = appWith([
      createStep('First task', 'call_1'),
      { text: 'Added the first.' },
      createStep('Second task', 'call_2'),
      { text: 'Added the second.' },
      { text: 'Two so far.' },
    ]);
    const { chatId, threadId } = await startChat();

    await send(app, chatId, 'Add the first task');
    await send(app, chatId, 'Add the second task');
    await send(app, chatId, 'How many now?');

    const { results } = await env.DB.prepare('SELECT 1 FROM checkpoints WHERE thread_id = ?')
      .bind(threadId)
      .all();
    expect(results.length).toBeLessThanOrEqual(3);

    // Pruning drops intermediate snapshots, not history: the newest checkpoint
    // carries the whole message list, which is what MessagesValue accumulates.
    const { body } = await history(app, chatId);
    expect(body.turns.map((turn) => turn.message)).toEqual([
      'Add the first task',
      'Add the second task',
      'How many now?',
    ]);
  });

  it('reads a conversation whose last turn failed', async () => {
    const app = appWith([createStep('Renew the domain', 'call_1'), { text: 'Added it.' }]);
    const { chatId } = await startChat();

    const failed = await send(app, chatId, 'Add a task to renew the domain', {
      bindings: { DB: dbFailingOn(env.DB, 'INSERT INTO tasks') },
    });
    expect(failed.status).toBe(503);

    // The user's message was checkpointed before the tool ran, so the turn is
    // visible even though it never produced a reply.
    const { status, body } = await history(app, chatId);
    expect(status).toBe(200);
    expect(body.turns).toEqual([
      { message: 'Add a task to renew the domain', reply: null, actions: [] },
    ]);
    // Nothing settled, so the chat never took the turn on.
    expect(body.chat.turn_count).toBe(0);
  });

  it('is empty for a conversation that has not run a turn', async () => {
    const { chatId } = await startChat();
    const { status, body } = await history(appWith([{ text: 'hi' }]), chatId);

    expect(status).toBe(200);
    expect(body.turns).toEqual([]);
    expect(body.chat.title).toBeNull();
  });

  it('needs no model, so it works without a Groq key', async () => {
    const app = appWith([{ text: 'Hello.' }]);
    const { chatId } = await startChat();
    await send(app, chatId, 'hi');

    const { status, body } = await history(app, chatId, { GROQ_API_KEY: undefined });

    expect(status).toBe(200);
    expect(body.turns).toHaveLength(1);
  });
});

describe('when the conversation is not there', () => {
  it('is 404 for a chat that was never created', async () => {
    const { status, body } = await history(appWith([{ text: 'hi' }]), crypto.randomUUID());

    expect(status).toBe(404);
    expect(body.error).toBe(ERRORS.CHAT_NOT_FOUND);
  });

  it('is 400 for an id that is not a UUID', async () => {
    const { status, body } = await history(appWith([{ text: 'hi' }]), 'not-a-uuid');

    expect(status).toBe(400);
    expect(body.error).toBe(ERRORS.CHAT_ID_INVALID);
  });

  it('refuses a message to a chat that does not exist', async () => {
    const { status, body } = await send(appWith([{ text: 'hi' }]), crypto.randomUUID(), 'hello');

    expect(status).toBe(404);
    expect(body.error).toBe(ERRORS.CHAT_NOT_FOUND);
  });
});
