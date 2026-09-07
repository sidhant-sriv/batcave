import type { Actor } from '../actor';
import { and, ownerClause, viaChatClause } from './owner';

/**
 * D1 access for the two tables a conversation is made of: the chat a client
 * holds a handle to, and the threads it has run on. Both live here because
 * neither is useful without the other.
 *
 * `chat_threads` carries no owner of its own: it references `chats(id)` with a
 * cascade, so the chat is where ownership lives and the thread queries reach it
 * through `chat_id`.
 */

export interface ChatRow {
  id: string;
  user_id: string;
  title: string | null;
  turn_count: number;
  created_at: string;
  last_message_at: string;
}

export interface ThreadRow {
  threadId: string;
  chatId: string;
  seq: number;
  createdAt: string;
}

/** A chat and the thread it starts on, in one batch: neither is usable alone. */
export async function insertChat(
  db: D1Database,
  chat: ChatRow,
  firstThreadId: string,
): Promise<ChatRow> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO chats (id, user_id, title, turn_count, created_at, last_message_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        chat.id,
        chat.user_id,
        chat.title,
        chat.turn_count,
        chat.created_at,
        chat.last_message_at,
      ),
    db
      .prepare(`INSERT INTO chat_threads (thread_id, chat_id, seq, created_at) VALUES (?, ?, 0, ?)`)
      .bind(firstThreadId, chat.id, chat.created_at),
  ]);

  return chat;
}

/**
 * Attaches another thread to an existing chat. Compaction is the caller: it
 * opens a fresh checkpoint partition at the next `seq` and leaves the older
 * ones in place, so the conversation reads back whole even though the agent
 * only ever sees the newest.
 */
export async function insertThread(db: D1Database, thread: ThreadRow): Promise<void> {
  await db
    .prepare(`INSERT INTO chat_threads (thread_id, chat_id, seq, created_at) VALUES (?, ?, ?, ?)`)
    .bind(thread.threadId, thread.chatId, thread.seq, thread.createdAt)
    .run();
}

export async function selectChat(
  db: D1Database,
  id: string,
  owner: Actor,
): Promise<ChatRow | null> {
  const scope = ownerClause(owner);
  const row = await db
    .prepare(`SELECT * FROM chats WHERE id = ?${and(scope)}`)
    .bind(id, ...scope.binds)
    .first<ChatRow>();
  return row ?? null;
}

/** The thread a chat is currently running on: its newest segment. */
export async function selectActiveThread(
  db: D1Database,
  chatId: string,
  owner: Actor,
): Promise<string | null> {
  const scope = viaChatClause(owner);
  const row = await db
    .prepare(
      `SELECT thread_id FROM chat_threads WHERE chat_id = ?${and(scope)}` +
        ' ORDER BY seq DESC LIMIT 1',
    )
    .bind(chatId, ...scope.binds)
    .first<{ thread_id: string }>();
  return row?.thread_id ?? null;
}

/** Every thread a chat has run on, oldest first, which is reading order. */
export async function selectThreads(
  db: D1Database,
  chatId: string,
  owner: Actor,
): Promise<string[]> {
  const scope = viaChatClause(owner);
  const { results } = await db
    .prepare(
      `SELECT thread_id FROM chat_threads WHERE chat_id = ?${and(scope)} ORDER BY seq ASC`,
    )
    .bind(chatId, ...scope.binds)
    .all<{ thread_id: string }>();
  return results.map((row) => row.thread_id);
}

/**
 * Asks for one more row than the caller wants, so `truncated` costs no second
 * query. Ties break on id, which is a uuidv7 and so orders by creation.
 */
export async function listChats(
  db: D1Database,
  limit: number,
  owner: Actor,
): Promise<ChatRow[]> {
  const scope = ownerClause(owner);
  const where = scope.sql ? `WHERE ${scope.sql} ` : '';
  const { results } = await db
    .prepare(`SELECT * FROM chats ${where}ORDER BY last_message_at DESC, id DESC LIMIT ?`)
    .bind(...scope.binds, limit + 1)
    .all<ChatRow>();
  return results;
}

/**
 * One statement per answered turn. `COALESCE` is what makes the first message
 * name an untitled chat while every later one leaves the name alone, so an
 * explicit rename is never overwritten and no read is needed first.
 */
export async function touchChat(
  db: D1Database,
  id: string,
  at: string,
  title: string,
  owner: Actor,
): Promise<ChatRow | null> {
  const scope = ownerClause(owner);
  const row = await db
    .prepare(
      `UPDATE chats
          SET last_message_at = ?, turn_count = turn_count + 1, title = COALESCE(title, ?)
        WHERE id = ?${and(scope)}
        RETURNING *`,
    )
    .bind(at, title, id, ...scope.binds)
    .first<ChatRow>();
  return row ?? null;
}

export async function renameChat(
  db: D1Database,
  id: string,
  title: string | null,
  owner: Actor,
): Promise<ChatRow | null> {
  const scope = ownerClause(owner);
  const row = await db
    .prepare(`UPDATE chats SET title = ? WHERE id = ?${and(scope)} RETURNING *`)
    .bind(title, id, ...scope.binds)
    .first<ChatRow>();
  return row ?? null;
}

/** The chat row only. `chat_threads` follows it through the foreign key. */
export async function deleteChat(db: D1Database, id: string, owner: Actor): Promise<void> {
  const scope = ownerClause(owner);
  await db
    .prepare(`DELETE FROM chats WHERE id = ?${and(scope)}`)
    .bind(id, ...scope.binds)
    .run();
}
