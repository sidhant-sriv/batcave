import { useQuery } from '@tanstack/react-query';
import { SCHED_LIMIT_MAX, listNotifications, listSchedules } from '@/api/schedules';
import type { ScheduleWithTask } from '@/api/types';

/**
 * The scheduled data, shared.
 *
 * Both hooks use the same query keys the scheduled surface itself uses, so the
 * navigator badge, the index's schedule column and the page are one response
 * rather than three, and opening the page costs no extra request.
 *
 * The poll exists because notifications are written by a Workflow, never by a
 * request: nothing the client does can produce the response that tells it one
 * fired, so it has to ask.
 */

const POLL_MS = 60_000;

/** Active schedules, by the task each belongs to. A task has at most one. */
export function useSchedulesByTask(): Map<string, ScheduleWithTask> {
  const schedules = useQuery({
    queryKey: ['schedules'],
    queryFn: () => listSchedules({ limit: SCHED_LIMIT_MAX }),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  const map = new Map<string, ScheduleWithTask>();
  for (const schedule of schedules.data?.schedules ?? []) {
    if (schedule.status === 'active') map.set(schedule.task_id, schedule);
  }

  return map;
}

/**
 * How many firings are waiting to be dismissed.
 *
 * A skipped firing is not waiting for anything — it woke to find its task
 * already done — so it is history the moment it is written and never counted.
 */
export function useDueNowCount(): number {
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications({ limit: SCHED_LIMIT_MAX }),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  return (notifications.data?.notifications ?? []).filter(
    (row) => row.acknowledged_at === null && row.outcome === 'notified',
  ).length;
}
