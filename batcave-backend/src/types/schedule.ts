import type { Task } from './task';

export const SCHEDULE_KINDS = ['once', 'recurring'] as const;
export const SCHEDULE_STATUSES = ['active', 'ended', 'cancelled'] as const;
export const NOTIFICATION_OUTCOMES = ['notified', 'skipped'] as const;

export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
export type NotificationOutcome = (typeof NOTIFICATION_OUTCOMES)[number];

/** A row of `schedules`. The id doubles as the Workflow instance id. */
export interface Schedule {
  id: string;
  task_id: string;
  kind: ScheduleKind;
  /** Five-field cron in UTC; null for a one-shot. */
  cron: string | null;
  next_at: string;
  status: ScheduleStatus;
  notification_count: number;
  created_at: string;
  ended_at: string | null;
}

/** A row of `notifications`: one firing of a schedule. */
export interface Notification {
  id: string;
  schedule_id: string;
  task_id: string;
  seq: number;
  notified_at: string;
  outcome: NotificationOutcome;
  /** SQLite has no boolean; 1 when this firing reopened a done task. */
  reopened: 0 | 1;
  acknowledged_at: string | null;
}

/** What the lists return: the row plus the task it belongs to, joined once. */
export type ScheduleWithTask = Schedule & { task: Task };
export type NotificationWithTask = Notification & { task: Task };

/**
 * The Workflow payload. Only the id: everything else is read from the row on
 * every step, so cancelling or replacing a schedule is a D1 write and never a
 * message to the instance.
 */
export interface ScheduleParams {
  scheduleId: string;
}
