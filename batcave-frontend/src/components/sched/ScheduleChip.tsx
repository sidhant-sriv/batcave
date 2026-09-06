import type { Schedule } from '@/api/types';
import { cn } from '@/lib/cn';
import { formatInstant, fullTimestamp } from '@/lib/time';

/**
 * When a schedule fires next, in the same 16px mono box as `DueChip`.
 *
 * It borrows the due palette rather than introducing one, because the two
 * chips answer neighbouring questions — when is this expected, when will I hear
 * about it — and a second colour system would imply a distinction that is not
 * there. Colour is never the only signal: a repeating schedule carries `↻`, and
 * a finished one says the word.
 */

const TONES = {
  once: 'text-due-future-fg border-due-future-fg/25',
  recurring: 'text-due-soon-fg bg-due-soon-bg border-due-soon-border',
  inactive: 'text-due-none-fg border-transparent',
} as const;

/** The cron, said in words where it is worth the characters. */
export function describeSchedule(schedule: Schedule): string {
  if (schedule.status === 'cancelled') return 'Cancelled';
  if (schedule.status === 'ended') return 'Ended';

  const at = fullTimestamp(schedule.next_at);
  return schedule.kind === 'recurring'
    ? `Repeats on ${schedule.cron} (UTC). Next: ${at}`
    : `Notifies once at ${at}`;
}

export function ScheduleChip({ schedule, className }: { schedule: Schedule; className?: string }) {
  const inactive = schedule.status !== 'active';
  const tone = inactive ? TONES.inactive : TONES[schedule.kind];

  const label = inactive
    ? schedule.status === 'cancelled'
      ? 'Cancelled'
      : 'Ended'
    : `${schedule.kind === 'recurring' ? '↻ ' : ''}${formatInstant(schedule.next_at)}`;

  return (
    <span
      title={describeSchedule(schedule)}
      className={cn(
        'inline-flex h-[var(--due-chip-h)] shrink-0 items-center',
        'rounded-xs border px-[var(--due-chip-pad-x)]',
        'font-mono text-micro uppercase whitespace-nowrap',
        tone,
        className,
      )}
    >
      {label}
    </span>
  );
}
