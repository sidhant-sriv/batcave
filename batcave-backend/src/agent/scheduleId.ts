import { derivedUuid } from '../ids';

/** Namespaced so a tool call id can never collide with a derived task id. */
const SCHEDULE_ID_NAMESPACE = 'batcave:schedule';

/**
 * The schedule id for a scheduling tool call, derived from the call's id rather
 * than generated, for the same reason `taskId` is: a re-run of an interrupted
 * tool call has to land on the same primary key, or the retry would replace the
 * schedule its first attempt created and start a second Workflow instance.
 *
 * The id is also the Workflow instance id. Instance ids cannot be reused after
 * termination, which is why a genuine reschedule — a new tool call — derives a
 * new one rather than reviving the old.
 */
export const scheduleId = (toolCallId: string): Promise<string> =>
  derivedUuid(SCHEDULE_ID_NAMESPACE, toolCallId);
