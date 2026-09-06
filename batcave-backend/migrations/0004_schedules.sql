-- Migration number: 0004 	 2026-09-06T00:00:00.000Z

-- A schedule is the agent's one way to make something happen later: a one-shot
-- reminder, or a cron that fires until cancelled. The Workflow instance that
-- sleeps for it shares its id, so a row and its clock are found by one key.
-- The row is the truth the UI reads; the instance only ever writes back here.
--
-- A task has at most one active schedule. Scheduling again replaces it, which
-- the partial unique index enforces without a read first.
CREATE TABLE schedules (
  id                 TEXT PRIMARY KEY,
  task_id            TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('once', 'recurring')),
  -- Recurring only. Five fields, evaluated in UTC.
  cron               TEXT,
  -- The next firing as an ISO instant, which is what the Upcoming list shows.
  next_at            TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('active', 'ended', 'cancelled')),
  -- Guards the advance: a retried workflow step must not move a schedule twice.
  notification_count INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  ended_at           TEXT
);

CREATE UNIQUE INDEX idx_schedules_active_task ON schedules (task_id) WHERE status = 'active';
CREATE INDEX idx_schedules_status_next ON schedules (status, next_at);

-- One row per firing: the inbox. Kept after the schedule ends so the history
-- of what rang, and whether anyone saw it, survives the instance.
CREATE TABLE notifications (
  id              TEXT PRIMARY KEY,
  schedule_id     TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  -- 1 for the first firing of a schedule. The id is derived from (schedule, seq)
  -- so a retried step upserts the same row instead of adding a second.
  seq             INTEGER NOT NULL,
  notified_at     TEXT NOT NULL,
  -- `skipped` is a one-shot that woke to find its task already done.
  outcome         TEXT NOT NULL CHECK (outcome IN ('notified', 'skipped')),
  -- 1 when a recurring firing flipped a done task back to todo.
  reopened        INTEGER NOT NULL DEFAULT 0,
  -- Set by the user, never by a timer.
  acknowledged_at TEXT,
  UNIQUE (schedule_id, seq)
);

CREATE INDEX idx_notifications_inbox ON notifications (acknowledged_at, notified_at);
