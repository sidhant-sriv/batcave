import { derivedUuid } from '../ids';

/** Namespaces the derivation so a tool call id can never collide with any
 *  other name we might one day derive an id from. */
const TASK_ID_NAMESPACE = 'batcave:task';

/**
 * The task id for a `create_task` tool call, derived from the call's id rather
 * than generated. `create_task` is the only non-idempotent tool — updates are
 * naturally idempotent — so a re-run of an interrupted tool call has to land on
 * the same primary key. Paired with the upsert in `db/tasks.ts`, the second
 * attempt returns the row the first one wrote instead of creating a duplicate.
 */
export const taskId = (toolCallId: string): Promise<string> =>
  derivedUuid(TASK_ID_NAMESPACE, toolCallId);
