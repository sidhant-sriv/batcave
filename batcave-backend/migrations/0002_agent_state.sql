-- Migration number: 0002 	 2026-09-05T00:00:00.000Z

-- Checkpointer tables. The schema is copied verbatim from
-- langgraph-checkpoint-cloudflare-d1 0.2.0, which would otherwise create them
-- itself with four D1 round trips on every request. `src/agent/checkpointer.ts`
-- suppresses that DDL, so this migration is the owner. The saver version is
-- pinned; if it bumps its schema, the migration to match is ours to write.
CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id            TEXT NOT NULL,
  checkpoint_ns        TEXT NOT NULL DEFAULT '',
  checkpoint_id        TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type                 TEXT,
  checkpoint           BLOB,
  metadata             BLOB,
  created_at           INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS writes (
  thread_id     TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  idx           INTEGER NOT NULL,
  channel       TEXT NOT NULL,
  type          TEXT,
  value         BLOB,
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_created
  ON checkpoints (thread_id, created_at);

-- One row per turn. Doubles as retry dedup, the same-thread concurrency lock,
-- and a run history for debugging: what was asked, what came back, what failed.
CREATE TABLE agent_runs (
  run_key             TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  message             TEXT NOT NULL,
  response            TEXT,
  error               TEXT,
  -- The thread's latest checkpoint when the run was first claimed. A takeover
  -- compares it against the thread's current checkpoint to tell an interrupted
  -- turn from one that finished before the run row could be marked complete.
  start_checkpoint_id TEXT,
  -- 1 on the first claim, incremented on every takeover.
  attempts            INTEGER NOT NULL DEFAULT 1,
  started_at          INTEGER NOT NULL,
  ended_at            INTEGER
);

CREATE INDEX idx_agent_runs_thread ON agent_runs (thread_id, started_at);
CREATE INDEX idx_agent_runs_status ON agent_runs (status, started_at);
