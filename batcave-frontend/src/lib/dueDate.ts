import type { AnyTask, TaskStatus } from '@/api/types';

/**
 * Due-date semantics.
 *
 * This is derived state, not a stored field, and it is derived in exactly one
 * place so that a card, a row and a chat result can never disagree about
 * whether something is late.
 *
 * "Today" is UTC, matching the agent's own `todayUtc()`. That is deliberate: if
 * the client used local midnight, a user west of UTC would see a task marked
 * overdue that the agent still considers due today, and the prose in the
 * transcript would contradict the chip beside it.
 */

export type DueBucket = 'overdue' | 'today' | 'soon' | 'future' | 'none';

/** Days ahead that still count as "soon" rather than merely "future". */
const SOON_DAYS = 3;

const MS_PER_DAY = 86_400_000;

/** Today in UTC as `YYYY-MM-DD`, the format due dates are stored in. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative means past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * A completed task is never overdue. Finishing something late does not leave it
 * flagged red forever — the deadline stopped mattering when the work landed.
 */
export function dueBucket(
  dueDate: string | null,
  status: TaskStatus,
  today: string = todayUtc(),
): DueBucket {
  if (!dueDate) return 'none';

  const delta = daysBetween(today, dueDate);

  if (delta === 0) return 'today';
  if (delta < 0) return status === 'done' ? 'future' : 'overdue';
  return delta <= SOON_DAYS ? 'soon' : 'future';
}

export function taskDueBucket(task: AnyTask, today: string = todayUtc()): DueBucket {
  return dueBucket(task.due_date, task.status, today);
}

/**
 * What the chip actually says.
 *
 * `overdue` and `today` never rely on colour alone: one carries a `!` register
 * mark, the other spells the word out instead of showing a date.
 */
export function dueLabel(
  dueDate: string | null,
  bucket: DueBucket,
  today: string = todayUtc(),
): string {
  if (!dueDate || bucket === 'none') return '—';
  if (bucket === 'today') return 'TODAY';

  const delta = daysBetween(today, dueDate);
  if (bucket === 'overdue') {
    const late = Math.abs(delta);
    return `! ${late}D LATE`;
  }
  if (bucket === 'soon') return `${delta}D`;

  return formatDate(dueDate);
}

/** `2026-09-11` becomes `11 SEP`; a different year keeps the year. */
export function formatDate(date: string, today: string = todayUtc()): string {
  const [year, month, day] = date.split('-');
  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  const name = months[Number(month) - 1] ?? month;
  const label = `${Number(day)} ${name}`;

  return year === today.slice(0, 4) ? label : `${label} ${year}`;
}

/** Full, unambiguous text for a tooltip or a screen reader. */
export function dueDescription(dueDate: string | null, bucket: DueBucket): string {
  if (!dueDate) return 'No due date';
  if (bucket === 'today') return `Due today, ${dueDate}`;
  if (bucket === 'overdue') return `Overdue, was due ${dueDate}`;
  return `Due ${dueDate}`;
}
