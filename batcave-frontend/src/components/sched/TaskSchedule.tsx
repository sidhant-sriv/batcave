import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat } from 'lucide-react';
import { SCHED_LIMIT_MAX, cancelSchedule, listNotifications } from '@/api/schedules';
import type { NotificationWithTask, ScheduleWithTask } from '@/api/types';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/lib/cn';
import { describeCron } from '@/lib/cron';
import { useSchedulesByTask } from '@/lib/schedules';
import { formatInstant, fullTimestamp, relativeTime } from '@/lib/time';

/**
 * A task's schedule, inside the task.
 *
 * This is where the hierarchy is settled. A schedule has no life of its own —
 * it belongs to exactly one task and dies with it — so the place to read one,
 * and the only place to cancel one, is the record it is attached to. The
 * scheduled surface is a view across these, not their home.
 *
 * There is no way to create one here, and that is deliberate rather than
 * unfinished: schedules are made of language, and resolving "every Monday" into
 * a cron is the agent's job. A form would only be able to ask for the cron.
 *
 * Renders nothing when a task has never been scheduled, so an ordinary task's
 * detail is not padded with an empty section explaining its own absence.
 */

export function TaskSchedule({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient();
  const schedule = useSchedulesByTask().get(taskId) ?? null;

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications({ limit: SCHED_LIMIT_MAX }),
  });

  const cancel = useMutation({
    mutationFn: (row: ScheduleWithTask) => cancelSchedule(row.id),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ]),
  });

  const history = (notifications.data?.notifications ?? [])
    .filter((row) => row.task_id === taskId)
    .slice(0, 5);

  if (!schedule && history.length === 0) return null;

  return (
    <section
      className={cn(
        'flex flex-col gap-[var(--space-3)] rounded-xs border border-divider',
        'bg-app p-[var(--space-3)]',
      )}
    >
      <header className="flex items-center gap-[var(--space-2)]">
        <Repeat size={14} strokeWidth={1.5} className="text-muted" aria-hidden />
        <h3 className="font-mono text-micro uppercase text-muted">Schedule</h3>

        {schedule ? (
          <Button
            size="sm"
            className="ml-auto"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(schedule)}
          >
            {cancel.isPending ? 'Cancelling' : 'Cancel'}
          </Button>
        ) : (
          <span className="ml-auto font-mono text-micro uppercase text-disabled">
            No active schedule
          </span>
        )}
      </header>

      {schedule ? (
        <div className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-3">
          <Field label="Kind">{schedule.kind === 'recurring' ? 'Recurring' : 'Once'}</Field>

          <Field label="Cron · UTC">
            {schedule.kind === 'recurring' && schedule.cron ? (
              <>
                <span className="font-mono text-mono-sm text-primary">{schedule.cron}</span>
                <span className="font-prose text-body-sm text-muted">
                  {describeCron(schedule.cron)}
                </span>
              </>
            ) : (
              <span className="text-muted">—</span>
            )}
          </Field>

          <Field label="Next">
            <span title={fullTimestamp(schedule.next_at)} className="text-accent">
              {formatInstant(schedule.next_at)}
            </span>
          </Field>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="flex flex-col gap-[var(--space-2)] border-t border-hairline pt-[var(--space-2)]">
          <span className="font-mono text-micro uppercase text-disabled">
            {history.length === 1 ? '1 notification' : `${history.length} notifications`}
          </span>

          {history.map((row) => (
            <Firing key={row.id} notification={row} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Firing({ notification }: { notification: NotificationWithTask }) {
  return (
    <div className="flex items-center gap-[var(--space-3)] font-mono text-micro uppercase">
      <span title={fullTimestamp(notification.notified_at)} className="w-[128px] shrink-0 text-muted">
        {formatInstant(notification.notified_at)}
      </span>

      <span className="min-w-0 flex-1 truncate text-secondary">
        {notification.outcome === 'skipped'
          ? 'Skipped · already done'
          : notification.reopened
            ? 'Notified · reopened the task'
            : 'Notified'}
      </span>

      <span className="shrink-0 text-disabled">
        {notification.acknowledged_at
          ? `Dismissed ${relativeTime(notification.acknowledged_at)}`
          : notification.outcome === 'notified'
            ? 'Waiting'
            : ''}
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="font-mono text-micro uppercase text-disabled">{label}</span>
      <span className="flex flex-col font-prose text-body-sm text-secondary">{children}</span>
    </div>
  );
}
