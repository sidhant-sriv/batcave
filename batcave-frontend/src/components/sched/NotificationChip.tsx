import type { Notification } from '@/api/types';
import { cn } from '@/lib/cn';
import { fullTimestamp, relativeTime, shortDate } from '@/lib/time';

/**
 * One firing, as it reads in the inbox.
 *
 * Unacknowledged carries the `today` tone — this is the one thing on the
 * surface asking for attention — and drops to the muted `none` tone once the
 * user has dismissed it. A `skipped` firing is not a failure and is never red:
 * the reminder ran, and the work was already done.
 */

const TONES = {
  unread: 'text-due-today-fg bg-due-today-bg border-due-today-border',
  read: 'text-due-none-fg border-transparent',
} as const;

export function NotificationChip({
  notification,
  className,
}: {
  notification: Notification;
  className?: string;
}) {
  const unread = notification.acknowledged_at === null;
  const skipped = notification.outcome === 'skipped';

  const label = skipped
    ? `Skipped ${shortDate(notification.notified_at)}`
    : unread
      ? relativeTime(notification.notified_at)
      : shortDate(notification.notified_at);

  return (
    <span
      title={
        skipped
          ? `Nothing to do: the task was already done at ${fullTimestamp(notification.notified_at)}`
          : `Notified ${fullTimestamp(notification.notified_at)}`
      }
      className={cn(
        'inline-flex h-[var(--due-chip-h)] shrink-0 items-center gap-[4px]',
        'rounded-xs border px-[var(--due-chip-pad-x)]',
        'font-mono text-micro uppercase whitespace-nowrap',
        unread && !skipped ? TONES.unread : TONES.read,
        className,
      )}
    >
      {!skipped && unread ? <span aria-hidden>●</span> : null}
      {label}
    </span>
  );
}
