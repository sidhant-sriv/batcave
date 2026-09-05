import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { claim, runKey } from '../src/agent/runs';
import { insertThread, selectActiveThread } from '../src/db/chats';
import { onError } from '../src/index';
import { uuidv7 } from '../src/ids';
import { createChatRoute } from '../src/routes/chat';
import {
  ChatBusyError,
  ChatNotFoundError,
  ChatService,
  ChatValidationError,
  titleFrom,
} from '../src/services/chatService';
import type { Env } from '../src/types/task';
import { send } from './helpers/chat';
import { resetDb } from './helpers/reset';
import { ScriptedModel, type ScriptStep } from './helpers/scriptedModel';

beforeEach(resetDb);

const service = () => new ChatService(env.DB);

/** Real turns, so the tests below run against checkpoints the agent wrote. */
function agentApp(script: ScriptStep[]) {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/chats', createChatRoute({ model: new ScriptedModel(script) }));
  app.onError(onError);
  return app;
}

const countRows = async (table: string, threadId: string) => {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE thread_id = ?`)
    .bind(threadId)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

const setLastMessageAt = (chatId: string, at: string) =>
  env.DB.prepare('UPDATE chats SET last_message_at = ? WHERE id = ?').bind(at, chatId).run();

describe('creating a chat', () => {
  it('makes the chat and the thread it starts on', async () => {
    const { chat, threadId } = await service().create();

    expect(chat.title).toBeNull();
    expect(chat.turn_count).toBe(0);
    expect(await selectActiveThread(env.DB, chat.id)).toBe(threadId);
  });

  it('keeps the public handle and the checkpoint key separate', async () => {
    const { chat, threadId } = await service().create();
    expect(chat.id).not.toBe(threadId);
  });
});

describe('resolving the thread a turn runs on', () => {
  it('is the newest segment, so a compacted chat runs on its latest thread', async () => {
    const chats = service();
    const { chat } = await chats.create();

    const compacted = uuidv7();
    await insertThread(env.DB, {
      threadId: compacted,
      chatId: chat.id,
      seq: 1,
      createdAt: new Date().toISOString(),
    });

    expect(await chats.activeThread(chat.id)).toBe(compacted);
  });

  it('refuses a chat that is not there rather than inventing one', async () => {
    await expect(service().activeThread(crypto.randomUUID())).rejects.toThrow(ChatNotFoundError);
  });

  it('refuses an id that is not a uuid', async () => {
    await expect(service().activeThread('not-a-uuid')).rejects.toThrow(ChatValidationError);
  });
});

describe('titles', () => {
  it('names an untitled chat after its first message', async () => {
    const chats = service();
    const { chat } = await chats.create();

    await chats.touch(chat.id, 'Add a task to renew the domain');

    const after = await chats.get(chat.id);
    expect(after.title).toBe('Add a task to renew the domain');
    expect(after.turn_count).toBe(1);
  });

  it('leaves the name alone on later messages, and keeps counting', async () => {
    const chats = service();
    const { chat } = await chats.create();

    await chats.touch(chat.id, 'first message');
    await chats.touch(chat.id, 'second message');

    const after = await chats.get(chat.id);
    expect(after.title).toBe('first message');
    expect(after.turn_count).toBe(2);
  });

  it('never overwrites a name the client set', async () => {
    const chats = service();
    const { chat } = await chats.create();

    await chats.rename(chat.id, { title: 'Domain admin' });
    await chats.touch(chat.id, 'Add a task to renew the domain');

    expect((await chats.get(chat.id)).title).toBe('Domain admin');
  });

  it('clears back to untitled, and auto-names again after that', async () => {
    const chats = service();
    const { chat } = await chats.create();

    await chats.rename(chat.id, { title: 'Domain admin' });
    expect((await chats.rename(chat.id, { title: null })).title).toBeNull();

    await chats.touch(chat.id, 'Add a task');
    expect((await chats.get(chat.id)).title).toBe('Add a task');
  });

  it('rejects a body that changes nothing, or an unknown field', async () => {
    const chats = service();
    const { chat } = await chats.create();

    await expect(chats.rename(chat.id, {} as never)).rejects.toThrow(ChatValidationError);
    await expect(chats.rename(chat.id, { turn_count: 99 } as never)).rejects.toThrow(
      ChatValidationError,
    );
  });

  it('shortens a first message too long to be a title', () => {
    const long = 'Add a task to renew the domain and another to write the backend tests please';
    expect(titleFrom(long)).toHaveLength(60);
    expect(titleFrom(long).endsWith('...')).toBe(true);
    expect(titleFrom('  spaced   out  ')).toBe('spaced out');
  });
});

describe('listing', () => {
  it('is newest conversation first', async () => {
    const chats = service();
    const oldest = (await chats.create()).chat;
    const middle = (await chats.create()).chat;
    const newest = (await chats.create()).chat;

    await setLastMessageAt(oldest.id, '2026-01-01T00:00:00.000Z');
    await setLastMessageAt(middle.id, '2026-06-01T00:00:00.000Z');
    await setLastMessageAt(newest.id, '2026-09-01T00:00:00.000Z');

    const { chats: rows } = await chats.list();
    expect(rows.map((row) => row.id)).toEqual([newest.id, middle.id, oldest.id]);
  });

  it('reports truncation without a second query', async () => {
    const chats = service();
    await chats.create();
    await chats.create();
    await chats.create();

    const page = await chats.list({ limit: 2 });
    expect(page.chats).toHaveLength(2);
    expect(page.truncated).toBe(true);

    expect((await chats.list({ limit: 20 })).truncated).toBe(false);
  });

  it('refuses a limit outside the range', async () => {
    await expect(service().list({ limit: 0 })).rejects.toThrow(ChatValidationError);
    await expect(service().list({ limit: 500 })).rejects.toThrow(ChatValidationError);
  });
});

describe('history', () => {
  it('is empty for a chat that has not run a turn', async () => {
    const chats = service();
    const { chat } = await chats.create();
    expect(await chats.history(chat.id)).toEqual([]);
  });

  it('spans every thread the chat has run on, oldest segment first', async () => {
    const app = agentApp([
      { text: 'Answered the first.' },
      { text: 'Answered the second.' },
      { text: 'Answered the third.' },
    ]);
    const chats = service();
    const { chat } = await chats.create();

    await send(app, chat.id, 'before compaction');

    // What compaction will do: a fresh checkpoint partition at the next seq,
    // with the older one left in place. The next turn routes itself there,
    // because the route only ever asks for the chat's active thread.
    await insertThread(env.DB, {
      threadId: uuidv7(),
      chatId: chat.id,
      seq: 1,
      createdAt: new Date().toISOString(),
    });
    await send(app, chat.id, 'after compaction');

    const turns = await chats.history(chat.id);
    expect(turns.map((entry) => entry.message)).toEqual([
      'before compaction',
      'after compaction',
    ]);
    expect(turns[0]!.reply).toBe('Answered the first.');
  });

  it('refuses a chat that is not there', async () => {
    await expect(service().history(crypto.randomUUID())).rejects.toThrow(ChatNotFoundError);
  });
});

describe('deleting', () => {
  it('clears the chat, its threads and everything the agent left behind', async () => {
    const app = agentApp([{ text: 'Answered.' }]);
    const chats = service();
    const { chat, threadId } = await chats.create();

    await send(app, chat.id, 'say something');
    expect(await countRows('checkpoints', threadId)).toBeGreaterThan(0);
    expect(await countRows('agent_runs', threadId)).toBeGreaterThan(0);

    await chats.remove(chat.id);

    expect(await countRows('checkpoints', threadId)).toBe(0);
    expect(await countRows('writes', threadId)).toBe(0);
    expect(await countRows('agent_runs', threadId)).toBe(0);
    expect(await selectActiveThread(env.DB, chat.id)).toBeNull();
    await expect(chats.get(chat.id)).rejects.toThrow(ChatNotFoundError);
  });

  it('refuses while a turn is still running, rather than racing it', async () => {
    const chats = service();
    const { chat, threadId } = await chats.create();

    await claim(env.DB, {
      key: await runKey({ threadId, message: 'hi', checkpointId: null }),
      threadId,
      message: 'hi',
      startCheckpointId: null,
    });

    await expect(chats.remove(chat.id)).rejects.toThrow(ChatBusyError);
    expect(await chats.get(chat.id)).toBeTruthy();
  });

  it('goes ahead once that run has outlived its TTL', async () => {
    const chats = service();
    const { chat, threadId } = await chats.create();

    await claim(env.DB, {
      key: await runKey({ threadId, message: 'hi', checkpointId: null }),
      threadId,
      message: 'hi',
      startCheckpointId: null,
    });
    await env.DB.prepare('UPDATE agent_runs SET started_at = 0 WHERE thread_id = ?')
      .bind(threadId)
      .run();

    await chats.remove(chat.id);
    await expect(chats.get(chat.id)).rejects.toThrow(ChatNotFoundError);
  });

  it('refuses a chat that is not there', async () => {
    await expect(service().remove(crypto.randomUUID())).rejects.toThrow(ChatNotFoundError);
  });
});
