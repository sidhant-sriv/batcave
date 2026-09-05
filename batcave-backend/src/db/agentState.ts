/**
 * D1 access for the agent's own tables: the run rows that make a turn
 * idempotent, and pruning of the checkpoints the saver writes.
 */

export type AgentRunStatus = 'running' | 'completed' | 'failed';

export interface AgentRunRow {
  run_key: string;
  thread_id: string;
  status: AgentRunStatus;
  message: string;
  response: string | null;
  error: string | null;
  start_checkpoint_id: string | null;
  attempts: number;
  started_at: number;
  ended_at: number | null;
}

export interface ClaimParams {
  runKey: string;
  threadId: string;
  message: string;
  startCheckpointId: string | null;
  now: number;
  staleBefore: number;
}

/**
 * Claims the run in one statement, so there is no read-then-write race between
 * two requests arriving on the same thread at once. Returns the row when this
 * caller owns the turn, and null when it does not: the row is either still
 * running inside its TTL or already completed, which the caller tells apart
 * with `selectRun`.
 *
 * `start_checkpoint_id` is deliberately not touched on conflict. A takeover
 * needs to know where the thread stood when the turn first started, to tell an
 * interrupted turn from one that finished before its row could be marked.
 */
export async function claimRun(db: D1Database, params: ClaimParams): Promise<AgentRunRow | null> {
  return db
    .prepare(
      `INSERT INTO agent_runs
         (run_key, thread_id, status, message, start_checkpoint_id, attempts, started_at)
       VALUES (?, ?, 'running', ?, ?, 1, ?)
       ON CONFLICT (run_key) DO UPDATE SET
         status     = 'running',
         error      = NULL,
         attempts   = agent_runs.attempts + 1,
         started_at = excluded.started_at,
         ended_at   = NULL
       WHERE agent_runs.status = 'failed'
          OR (agent_runs.status = 'running' AND agent_runs.started_at <= ?)
       RETURNING *`,
    )
    .bind(
      params.runKey,
      params.threadId,
      params.message,
      params.startCheckpointId,
      params.now,
      params.staleBefore,
    )
    .first<AgentRunRow>();
}

export async function selectRun(db: D1Database, runKey: string): Promise<AgentRunRow | null> {
  const row = await db
    .prepare('SELECT * FROM agent_runs WHERE run_key = ?')
    .bind(runKey)
    .first<AgentRunRow>();
  return row ?? null;
}

export async function markRunCompleted(
  db: D1Database,
  runKey: string,
  response: string,
  endedAt: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE agent_runs
          SET status = 'completed', response = ?, error = NULL, ended_at = ?
        WHERE run_key = ?`,
    )
    .bind(response, endedAt, runKey)
    .run();
}

export async function markRunFailed(
  db: D1Database,
  runKey: string,
  error: string,
  endedAt: number,
): Promise<void> {
  await db
    .prepare(`UPDATE agent_runs SET status = 'failed', error = ?, ended_at = ? WHERE run_key = ?`)
    .bind(error, endedAt, runKey)
    .run();
}

/**
 * Every super-step writes the full channel state, since the saver has no delta
 * storage, so checkpoint rows for a thread grow with the square of the
 * conversation length. Keeping the newest few is enough to resume an
 * interrupted run; older ones are history nothing reads.
 *
 * Writes are deleted first and are selected against the checkpoints that
 * survive, so an interruption between the two statements can only leave extra
 * rows behind, never strip the writes off a checkpoint that is still reachable.
 */
export async function pruneThread(db: D1Database, threadId: string, keep: number): Promise<void> {
  const survivors = `SELECT checkpoint_id FROM checkpoints
                      WHERE thread_id = ?
                      ORDER BY checkpoint_id DESC
                      LIMIT ?`;

  await db.batch([
    db
      .prepare(`DELETE FROM writes WHERE thread_id = ? AND checkpoint_id NOT IN (${survivors})`)
      .bind(threadId, threadId, keep),
    db
      .prepare(`DELETE FROM checkpoints WHERE thread_id = ? AND checkpoint_id NOT IN (${survivors})`)
      .bind(threadId, threadId, keep),
  ]);
}

/**
 * Everything a thread left behind. The checkpointer's two tables have no
 * foreign key back to `chats`, because that schema is the saver's and was
 * copied verbatim, so a deleted conversation has to clear them by hand.
 */
export async function deleteThread(db: D1Database, threadId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM writes WHERE thread_id = ?').bind(threadId),
    db.prepare('DELETE FROM checkpoints WHERE thread_id = ?').bind(threadId),
    db.prepare('DELETE FROM agent_runs WHERE thread_id = ?').bind(threadId),
  ]);
}

/**
 * A run still believed to be in flight on any of these threads. Deleting a
 * conversation out from under a running turn would leave the graph writing
 * checkpoints nothing can reach, so the caller refuses rather than racing it.
 */
export async function selectLiveRun(
  db: D1Database,
  threadIds: string[],
  staleBefore: number,
): Promise<AgentRunRow | null> {
  if (threadIds.length === 0) return null;

  const placeholders = threadIds.map(() => '?').join(', ');
  const row = await db
    .prepare(
      `SELECT * FROM agent_runs
        WHERE thread_id IN (${placeholders})
          AND status = 'running'
          AND started_at > ?
        LIMIT 1`,
    )
    .bind(...threadIds, staleBefore)
    .first<AgentRunRow>();

  return row ?? null;
}
