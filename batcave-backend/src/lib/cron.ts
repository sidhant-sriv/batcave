import { Cron } from 'croner';
import { ERRORS } from '../errors';

/**
 * Cron parsing, kept pure so it can be unit tested without D1 or a Workflow.
 *
 * Returns a result rather than throwing: the service owns the error classes,
 * and having this module import them would make the dependency circular. It
 * also means every rejection carries a message the model can act on, since a
 * bad cron is exactly the kind of failure a model can fix by calling again.
 */

/**
 * A schedule that fires more often than this is almost never what someone
 * asked for, and each firing costs a workflow step and an inbox row. `* * * * *`
 * from a confused model would otherwise notify 1440 times a day.
 */
export const MIN_NOTIFICATION_GAP_MS = 15 * 60_000;

export interface CronSchedule {
  /** The next firing strictly after `from`, or null if there is none. */
  nextRun(from: Date): Date | null;
}

export type CronResult =
  | { ok: true; schedule: CronSchedule }
  | { ok: false; error: string };

/**
 * Everything is evaluated in UTC, which is the only timezone this application
 * has. Croner's own six-field form is refused by the schema before it gets
 * here, so a pattern that reaches this point is five fields.
 */
export function parseCron(expression: string, from: Date = new Date()): CronResult {
  let cron: Cron;
  try {
    cron = new Cron(expression, { timezone: 'UTC' });
  } catch {
    return { ok: false, error: ERRORS.SCHEDULE_CRON_INVALID };
  }

  // Two runs rather than one: the first proves it fires at all, and the gap
  // between them is the frequency check.
  const runs = cron.nextRuns(2, from);
  if (runs.length === 0) return { ok: false, error: ERRORS.SCHEDULE_CRON_NO_RUN };

  if (runs.length === 2 && runs[1]!.getTime() - runs[0]!.getTime() < MIN_NOTIFICATION_GAP_MS) {
    return { ok: false, error: ERRORS.SCHEDULE_CRON_TOO_FREQUENT };
  }

  return {
    ok: true,
    schedule: { nextRun: (at: Date) => cron.nextRun(at) },
  };
}
