import {
  NotificationNotFoundError,
  ScheduleNotFoundError,
  ScheduleValidationError,
} from '../../services/scheduleService';
import { TaskNotFoundError, TaskValidationError } from '../../services/taskService';

/**
 * Tool results are compact JSON strings so the model always reads the same
 * shape. Two error classes, split by who can act on them:
 *
 * - Failures the model caused and can correct — bad arguments, an id that is
 *   not in the table, a cron that never fires, a reminder in the past — come
 *   back as `{ ok: false }` for it to read and retry.
 * - Anything else is infrastructure. It is rethrown so the escalate middleware
 *   can take it out of the graph entirely, rather than laundering a D1 outage
 *   into a chat apology the client sees as a success.
 */
export async function envelope(
  run: () => Promise<Record<string, unknown>>,
): Promise<string> {
  try {
    return JSON.stringify({ ok: true, ...(await run()) });
  } catch (error) {
    if (error instanceof TaskValidationError) {
      return JSON.stringify({ ok: false, error: error.message, issues: error.issues });
    }
    if (error instanceof TaskNotFoundError) {
      return JSON.stringify({ ok: false, error: error.message });
    }
    if (error instanceof ScheduleValidationError) {
      return JSON.stringify({ ok: false, error: error.message, issues: error.issues });
    }
    if (error instanceof ScheduleNotFoundError || error instanceof NotificationNotFoundError) {
      return JSON.stringify({ ok: false, error: error.message });
    }
    throw error;
  }
}
