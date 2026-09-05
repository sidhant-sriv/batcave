import type { TaskStatus } from '@/api/types';
import { cn } from '@/lib/cn';
import { dueBucket, dueDescription, dueLabel, type DueBucket } from '@/lib/dueDate';

/**
 * The due date, in its derived form.
 *
 * Colour is never the only signal: `overdue` carries a `!` register mark and a
 * day count, `today` spells the word out rather than showing a date, and `none`
 * renders an em dash instead of collapsing to an empty cell — an absent value
 * is information, and a blank column is not.
 */

const TONES: Record<DueBucket, string> = {
  overdue: 'text-due-overdue-fg bg-due-overdue-bg border-due-overdue-border',
  today: 'text-due-today-fg bg-due-today-bg border-due-today-border',
  soon: 'text-due-soon-fg bg-due-soon-bg border-due-soon-border',
  future: 'text-due-future-fg border-transparent',
  none: 'text-due-none-fg border-transparent',
};

interface Props {
  dueDate: string | null;
  status: TaskStatus;
  className?: string;
}

export function DueChip({ dueDate, status, className }: Props) {
  const bucket = dueBucket(dueDate, status);

  return (
    <span
      title={dueDescription(dueDate, bucket)}
      className={cn(
        'inline-flex h-[var(--due-chip-h)] shrink-0 items-center',
        'rounded-xs border px-[var(--due-chip-pad-x)]',
        'font-mono text-micro uppercase whitespace-nowrap',
        TONES[bucket],
        className,
      )}
    >
      {dueLabel(dueDate, bucket)}
    </span>
  );
}
