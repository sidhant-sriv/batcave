import {
  claimRun as claimRunRow,
  markRunCompleted,
  markRunFailed,
  selectRun,
  type AgentRunRow,
} from '../db/agentState';
import { derivedUuid } from '../ids';
import { MAX_TOOL_ROUNDS } from './agent';
import { MODEL_TIMEOUT_MS } from './model';

/**
 * How long a `running` row is believed before another request may take it over.
 * Derived from the worst case a turn can legitimately take, one model call per
 * tool round plus the closing one, so the two cannot drift apart. This is the
 * weak point of the whole scheme: a turn that outlives the TTL can be taken
 * over while it is still running. Moving the graph into a Durable Object is the
 * structural fix if that ever bites.
 */
export const RUN_TTL_SECONDS = Math.ceil(((MAX_TOOL_ROUNDS + 1) * MODEL_TIMEOUT_MS) / 1000) + 20;

/** How many checkpoints a thread keeps: enough to resume an interrupted run. */
export const CHECKPOINTS_KEPT = 3;

export type ClaimResult =
  | { kind: 'claimed'; key: string; row: AgentRunRow }
  | { kind: 'takeover'; key: string; row: AgentRunRow }
  | { kind: 'replay'; key: string; response: unknown }
  | { kind: 'busy'; key: string };

const RUN_KEY_NAMESPACE = 'batcave:run';

/**
 * The key a turn is deduplicated by. An `Idempotency-Key` header makes it
 * exact, which is why the header is worth documenting; without one, fall back
 * to the thread's state plus the message. A genuine retry arrives against the
 * same checkpoint and derives the same key, while a user legitimately repeating
 * themselves has advanced the thread and gets a different one.
 *
 * Always scoped to the thread, so one client's header cannot collide with
 * another conversation.
 */
export function runKey(params: {
  header?: string;
  threadId: string;
  message: string;
  checkpointId: string | null;
}): Promise<string> {
  const seed = params.header
    ? `key ${params.header}`
    : `state ${params.checkpointId ?? 'new'} ${params.message}`;

  return derivedUuid(RUN_KEY_NAMESPACE, `${params.threadId} ${seed}`);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export async function claim(
  db: D1Database,
  params: { key: string; threadId: string; message: string; startCheckpointId: string | null },
): Promise<ClaimResult> {
  const now = nowSeconds();
  const row = await claimRunRow(db, {
    runKey: params.key,
    threadId: params.threadId,
    message: params.message,
    startCheckpointId: params.startCheckpointId,
    now,
    staleBefore: now - RUN_TTL_SECONDS,
  });

  if (row) {
    return { kind: row.attempts > 1 ? 'takeover' : 'claimed', key: params.key, row };
  }

  // The claim was refused, so a row exists that this request may not touch.
  // One extra read, only on this path, to say which case it is.
  const existing = await selectRun(db, params.key);
  if (existing?.status === 'completed' && existing.response !== null) {
    return { kind: 'replay', key: params.key, response: JSON.parse(existing.response) };
  }

  return { kind: 'busy', key: params.key };
}

export const complete = (db: D1Database, key: string, body: unknown): Promise<void> =>
  markRunCompleted(db, key, JSON.stringify(body), nowSeconds());

export const fail = (db: D1Database, key: string, error: unknown): Promise<void> =>
  markRunFailed(db, key, error instanceof Error ? error.message : String(error), nowSeconds());
