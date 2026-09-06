import { queryString, request } from './client';
import type {
  Notification,
  NotificationListResponse,
  NotificationResponse,
  Schedule,
  ScheduleListResponse,
  ScheduleResponse,
  ScheduleStatus,
} from './types';

/**
 * The scheduled surface: what is going to notify, and what already has.
 *
 * There is no create here, and that is the design rather than an omission.
 * Schedules are made of language — "every Monday", "the day before it's due" —
 * and resolving that into a cron or an instant is the agent's job. This module
 * only reads, dismisses and cancels.
 */

/** The backend's own maximum. Asking for more is a 400. */
export const SCHED_LIMIT_MAX = 100;

export async function listSchedules(filters: {
  status?: ScheduleStatus[];
  limit?: number;
} = {}): Promise<ScheduleListResponse> {
  return request<ScheduleListResponse>(`/api/schedules${queryString({ ...filters })}`);
}

/** Cancels rather than deletes: the row stays, marked cancelled. */
export async function cancelSchedule(scheduleId: string): Promise<Schedule> {
  const { schedule } = await request<ScheduleResponse>(`/api/schedules/${scheduleId}`, {
    method: 'DELETE',
  });
  return schedule;
}

export async function listNotifications(
  filters: { acknowledged?: boolean; limit?: number } = {},
): Promise<NotificationListResponse> {
  return request<NotificationListResponse>(`/api/notifications${queryString({ ...filters })}`);
}

export async function acknowledgeNotification(notificationId: string): Promise<Notification> {
  const { notification } = await request<NotificationResponse>(
    `/api/notifications/${notificationId}/acknowledge`,
    { method: 'POST' },
  );
  return notification;
}
