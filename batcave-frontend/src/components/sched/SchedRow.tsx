import type { AnyTask, NotificationWithTask, ScheduleWithTask } from '@/api/types';
import { Button } from '@/components/primitives/Button';
import { TaskRow } from '@/components/task/TaskRow';
import { cn } from '@/lib/cn';
import { NotificationChip } from './NotificationChip';
import { ScheduleChip } from './ScheduleChip';

/**
 * A scheduled thing, rendered as the task it is about.
 *
 * The task row is the same component the index uses, unchanged, which is the
 * system rule: a record looks identical wherever it appears. What this adds is
 * the chip and the one action that applies — and nothing else, because a row
 * that offers two verbs makes the reader choose before they have read.
 *
 * `historical` is deliberately *not* set. Unlike a transcript, this surface
 * shows live rows, so an agent mutation landing on one should flash it.
 */

interface Props {
  onOpenTask?: (task: AnyTask) => void;
  className?: string;
}

export function ScheduleSchedRow({
  schedule,
  onCancel,
  busy,
  onOpenTask,
  className,
}: Props & {
  schedule: ScheduleWithTask;
  onCancel?: (schedule: ScheduleWithTask) => void;
  busy?: boolean;
}) {
  return (
    <Row
      className={className}
      task={schedule.task}
      onOpenTask={onOpenTask}
      meta={schedule.kind === 'recurring' && schedule.cron ? schedule.cron : null}
      chip={<ScheduleChip schedule={schedule} />}
      action={
        schedule.status === 'active' && onCancel ? (
          <Button size="sm" disabled={busy} onClick={() => onCancel(schedule)}>
            Cancel
          </Button>
        ) : null
      }
    />
  );
}

export function NotificationSchedRow({
  notification,
  onDismiss,
  busy,
  onOpenTask,
  className,
}: Props & {
  notification: NotificationWithTask;
  onDismiss?: (notification: NotificationWithTask) => void;
  busy?: boolean;
}) {
  return (
    <Row
      className={className}
      task={notification.task}
      onOpenTask={onOpenTask}
      // Why a task the user finished is on their list again. Without this the
      // reopening looks like the app losing their work.
      meta={notification.reopened ? 'Reopened' : null}
      chip={<NotificationChip notification={notification} />}
      action={
        notification.acknowledged_at === null && onDismiss ? (
          <Button size="sm" disabled={busy} onClick={() => onDismiss(notification)}>
            Dismiss
          </Button>
        ) : null
      }
    />
  );
}

/** The shared anatomy, so a schedule and a notification line up column for column. */
function Row({
  task,
  meta,
  chip,
  action,
  onOpenTask,
  className,
}: Props & {
  task: AnyTask;
  meta: string | null;
  chip: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-center gap-[var(--space-3)]', className)}>
      <TaskRow task={task} onOpen={onOpenTask} showUpdated={false} className="min-w-0 flex-1" />

      <span className="w-[var(--sched-col-meta)] shrink-0 truncate text-right font-mono text-micro uppercase text-muted">
        {meta}
      </span>

      <span className="flex w-[var(--sched-col-chip)] shrink-0 justify-end">{chip}</span>

      {/* The slot is always here, so the chips above it stay in one column
          whether or not a given row has anything to do. */}
      <span className="flex w-[var(--sched-col-action)] shrink-0 justify-end">{action}</span>
    </div>
  );
}
