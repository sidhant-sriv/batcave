import type { AgentAction, AnyTask } from '@/api/types';
import { ScheduleChip, describeSchedule } from '@/components/sched/ScheduleChip';
import { TaskRow } from '@/components/task/TaskRow';
import { cn } from '@/lib/cn';

/**
 * A schedule the agent set, returned into the conversation.
 *
 * Same raised, corner-ticked panel as `ToolResultBlock`, for the same reason:
 * this came out of D1 and is referenceable, unlike the prose around it.
 *
 * It shows the time the schedule was set for, which is more than a tool chip is
 * allowed to say. That is not a loosening of the rule — the rule is that the
 * wire carries results and not arguments, and here the *result* echoes the
 * instant, so showing it is reporting rather than reconstructing.
 */

export function ScheduleResultBlock({
  action,
  onOpenTask,
  className,
}: {
  action: AgentAction;
  onOpenTask?: (task: AnyTask) => void;
  className?: string;
}) {
  const { schedule } = action;
  if (!schedule) return null;

  const cancelled = schedule.status === 'cancelled';

  return (
    <div
      className={cn(
        'ticked ml-[var(--toolchip-indent)] max-w-[var(--msg-max-w)]',
        'border border-[var(--toolresult-border)] bg-[var(--toolresult-bg)]',
        className,
      )}
    >
      <header
        className={cn(
          'flex items-center justify-between gap-[var(--space-3)] border-b border-hairline',
          'px-[var(--space-3)] py-[var(--space-1)]',
          'font-mono text-micro uppercase text-muted',
        )}
      >
        <span>{cancelled ? 'Schedule stopped' : 'Scheduled'}</span>
        {/* The cron in full, since it is the thing the agent actually chose and
            the prose above deliberately does not show it. */}
        <span className="truncate text-disabled">
          {schedule.kind === 'recurring' ? schedule.cron : null}
        </span>
      </header>

      <TaskRow task={schedule.task} onOpen={onOpenTask} showUpdated={false} historical />

      <p
        className={cn(
          'border-t border-hairline px-[var(--space-3)] py-[var(--space-2)]',
          'font-mono text-mono-sm text-secondary',
        )}
      >
        <ScheduleChip schedule={schedule} className="mr-[var(--space-2)] align-middle" />
        {describeSchedule(schedule)}
      </p>
    </div>
  );
}
