import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SCHED_LIMIT_MAX,
  acknowledgeNotification,
  cancelSchedule,
  listNotifications,
  listSchedules,
} from '@/api/schedules';
import type { NotificationWithTask, ScheduleWithTask, Task } from '@/api/types';
import { EmptyState, ErrorBanner, LoadingRows } from '@/components/state/States';
import { NavToggle } from '@/components/nav/NavToggle';
import { NotificationSchedRow, ScheduleSchedRow } from '@/components/sched/SchedRow';
import { TaskDetailModal } from '@/components/task/TaskDetailModal';
import { cn } from '@/lib/cn';

/**
 * What is going to happen, and what already has.
 *
 * The surface is a poll, and honest about it: notifications are written by a
 * Workflow with no request attached, so nothing can push them here. A minute is
 * frequent enough for something scheduled in hours or weeks, and refetching on
 * focus covers the case that actually matters — coming back to the tab.
 *
 * Four sections, in the order a person reads them: what wants me now, what is
 * coming, what happened, what is over. Each is a list of task rows, because the
 * subject of every one of them is a task.
 */

/** Long enough not to be a busy loop, short enough that a tab left open is current. */
const POLL_MS = 60_000;

export function SchedRoute() {
  const queryClient = useQueryClient();
  const [openTask, setOpenTask] = useState<Task | null>(null);

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications({ limit: SCHED_LIMIT_MAX }),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const schedules = useQuery({
    queryKey: ['schedules'],
    queryFn: () => listSchedules({ limit: SCHED_LIMIT_MAX }),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const dismiss = useMutation({
    mutationFn: (notification: NotificationWithTask) => acknowledgeNotification(notification.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const cancel = useMutation({
    mutationFn: (schedule: ScheduleWithTask) => cancelSchedule(schedule.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules'] }),
  });

  const allNotifications = notifications.data?.notifications ?? [];
  const allSchedules = schedules.data?.schedules ?? [];

  const dueNow = allNotifications.filter(
    (row) => row.acknowledged_at === null && row.outcome === 'notified',
  );
  const history = allNotifications.filter((row) => !dueNow.includes(row));
  const upcoming = allSchedules.filter((row) => row.status === 'active');
  const finished = allSchedules.filter((row) => row.status !== 'active');

  const loading = notifications.isLoading || schedules.isLoading;
  const error = notifications.error ?? schedules.error;
  const empty = allNotifications.length === 0 && allSchedules.length === 0;

  const openTaskFrom = (task: { id: string }) => setOpenTask(task as Task);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        className={cn(
          'flex h-[var(--shell-header-h)] shrink-0 items-center gap-[var(--space-3)]',
          'border-b border-divider px-[var(--space-4)]',
        )}
      >
        <NavToggle />
        <h1 className="font-mono text-micro uppercase text-muted">Scheduled</h1>
        {/* Everything on this page is UTC, and saying so once here is cheaper
            than the reader inferring it wrongly from a single chip. */}
        <p className="font-prose text-body-sm text-disabled">All times UTC</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[var(--shell-max-w)] flex-col gap-[var(--space-5)] py-[var(--space-4)]">
          {loading ? <LoadingRows rows={4} /> : null}

          {error ? (
            <ErrorBanner
              error={error}
              onRetry={() => {
                void notifications.refetch();
                void schedules.refetch();
              }}
              className="mx-[var(--space-4)]"
            />
          ) : null}

          {!loading && !error && empty ? (
            <EmptyState
              label="Nothing scheduled"
              message='Ask the agent for one: "remind me about the Cloudflare assignment on Friday", or "water the plants every Monday at 9".'
            />
          ) : null}

          <Section label="Due now" count={dueNow.length} hint="Waiting for you to dismiss">
            {dueNow.map((notification) => (
              <NotificationSchedRow
                key={notification.id}
                notification={notification}
                onDismiss={dismiss.mutate}
                busy={dismiss.isPending}
                onOpenTask={openTaskFrom}
              />
            ))}
          </Section>

          <Section label="Upcoming" count={upcoming.length}>
            {upcoming.map((schedule) => (
              <ScheduleSchedRow
                key={schedule.id}
                schedule={schedule}
                onCancel={cancel.mutate}
                busy={cancel.isPending}
                onOpenTask={openTaskFrom}
              />
            ))}
          </Section>

          <Section label="History" count={history.length}>
            {history.map((notification) => (
              <NotificationSchedRow
                key={notification.id}
                notification={notification}
                onOpenTask={openTaskFrom}
              />
            ))}
          </Section>

          <Section label="Ended" count={finished.length}>
            {finished.map((schedule) => (
              <ScheduleSchedRow key={schedule.id} schedule={schedule} onOpenTask={openTaskFrom} />
            ))}
          </Section>

          {notifications.data?.truncated || schedules.data?.truncated ? (
            <p
              className={cn(
                'border-t border-divider px-[var(--task-row-pad-x)] py-[var(--space-3)]',
                'font-mono text-micro uppercase text-disabled',
              )}
            >
              More than this fits — older entries are not shown
            </p>
          ) : null}
        </div>
      </div>

      <TaskDetailModal task={openTask} onOpenChange={(open) => !open && setOpenTask(null)} />
    </div>
  );
}

/**
 * A section renders nothing when it is empty rather than showing a placeholder:
 * four "nothing here" boxes would bury the one group that has something in it.
 */
function Section({
  label,
  count,
  hint,
  children,
}: {
  label: string;
  count: number;
  hint?: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;

  return (
    <section className="flex flex-col">
      <header
        className={cn(
          'flex items-center justify-between gap-[var(--space-3)]',
          'border-b border-divider px-[var(--task-row-pad-x)] pb-[var(--space-2)]',
          'font-mono text-micro uppercase',
        )}
      >
        <span className="text-muted">{label}</span>
        {hint ? <span className="ml-auto text-disabled">{hint}</span> : null}
        <span className="text-disabled">{count}</span>
      </header>

      <div className="px-[var(--task-row-pad-x)]">{children}</div>
    </section>
  );
}
