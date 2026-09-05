/**
 * D1 access for the two tables a conversation is made of: the chat a client
 * holds a handle to, and the threads it has run on. Both live here because
 * neither is useful without the other.
 */

export interface ChatRow {
  id: string;
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
        `INSERT INTO chats (id, title, turn_count, created_at, last_message_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(chat.id, chat.title, chat.turn_count, chat.created_at, chat.last_message_at),
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

export async function selectChat(db: D1Database, id: string): Promise<ChatRow | null> {
  const row = await db.prepare('SELECT * FROM chats WHERE id = ?').bind(id).first<ChatRow>();
  return row ?? null;
}

/** The thread a chat is currently running on: its newest segment. */
export async function selectActiveThread(db: D1Database, chatId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT thread_id FROM chat_threads WHERE chat_id = ? ORDER BY seq DESC LIMIT 1')
    .bind(chatId)
    .first<{ thread_id: string }>();
  return row?.thread_id ?? null;
}

/** Every thread a chat has run on, oldest first, which is reading order. */
export async function selectThreads(db: D1Database, chatId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT thread_id FROM chat_threads WHERE chat_id = ? ORDER BY seq ASC')
    .bind(chatId)
    .all<{ thread_id: string }>();
  return results.map((row) => row.thread_id);
}

/**
 * Asks for one more row than the caller wants, so `truncated` costs no second
 * query. Ties break on id, which is a uuidv7 and so orders by creation.
 */
export async function listChats(db: D1Database, limit: number): Promise<ChatRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM chats ORDER BY last_message_at DESC, id DESC LIMIT ?')
    .bind(limit + 1)
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
): Promise<ChatRow | null> {
  const row = await db
    .prepare(
      `UPDATE chats
          SET last_message_at = ?, turn_count = turn_count + 1, title = COALESCE(title, ?)
        WHERE id = ?
        RETURNING *`,
    )
    .bind(at, title, id)
    .first<ChatRow>();
  return row ?? null;
}

export async function renameChat(
  db: D1Database,
  id: string,
  title: string | null,
): Promise<ChatRow | null> {
  const row = await db
    .prepare('UPDATE chats SET title = ? WHERE id = ? RETURNING *')
    .bind(title, id)
    .first<ChatRow>();
  return row ?? null;
}

/** The chat row only. `chat_threads` follows it through the foreign key. */
export async function deleteChat(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM chats WHERE id = ?').bind(id).run();
}
