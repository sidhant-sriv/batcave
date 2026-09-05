-- Migration number: 0003 	 2026-09-05T00:00:00.000Z

-- A chat is the conversation a client holds a handle to. A thread is the
-- LangGraph checkpoint partition that conversation currently runs on. They are
-- one to one today, and keeping them apart is what buys two things: compaction
-- can move a chat onto a fresh thread without the client's handle changing,
-- and ownership has a row to live on when auth arrives.
CREATE TABLE chats (
  id              TEXT PRIMARY KEY,
  title           TEXT,
  -- Denormalised so listing chats never decodes a checkpoint. Counting
  -- agent_runs would be wrong: a retried turn is several attempts on one row.
  turn_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  last_message_at TEXT NOT NULL
);

-- Newest first, which is the only order a chat list is ever read in.
CREATE INDEX idx_chats_recent ON chats (last_message_at DESC);

CREATE TABLE chat_threads (
  thread_id  TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  -- 0 for the thread a chat starts on, one higher per compaction after that.
  seq        INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (chat_id, seq)
);

CREATE INDEX idx_chat_threads_chat ON chat_threads (chat_id, seq);

-- Threads that predate this migration become chats in their own right and keep
-- their id, so a handle a client already holds still resolves. agent_runs is
-- the source rather than checkpoints because nothing prunes it, so it still
-- knows the first and last turn of every thread that ever ran.
INSERT OR IGNORE INTO chats (id, title, turn_count, created_at, last_message_at)
SELECT thread_id,
       NULL,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END),
       strftime('%Y-%m-%dT%H:%M:%SZ', MIN(started_at), 'unixepoch'),
       strftime('%Y-%m-%dT%H:%M:%SZ', MAX(started_at), 'unixepoch')
  FROM agent_runs
 GROUP BY thread_id;

INSERT OR IGNORE INTO chat_threads (thread_id, chat_id, seq, created_at)
SELECT id, id, 0, created_at FROM chats;

-- Name the backfilled chats after their first message, the same rule
-- `titleFrom` applies to new ones. SQL cannot collapse internal whitespace the
-- way that does, which is cosmetic and only ever affects these rows: without
-- this a conversation nobody messages again would stay nameless forever.
UPDATE chats
   SET title = (
     SELECT CASE WHEN length(r.message) <= 60 THEN r.message
                 ELSE substr(r.message, 1, 57) || '...' END
       FROM agent_runs r
      WHERE r.thread_id = chats.id
      ORDER BY r.started_at ASC, r.rowid ASC
      LIMIT 1
   )
 WHERE title IS NULL;
