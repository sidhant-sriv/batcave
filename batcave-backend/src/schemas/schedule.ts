import { z } from 'zod';
import { ERRORS } from '../errors';
import { SCHEDULE_STATUSES } from '../types/schedule';
import { TASK_ID_FROM_RESULT, taskIdSchema } from './task';

export const SCHED_LIST_LIMIT_MAX = 100;
export const SCHED_LIST_LIMIT_DEFAULT = 50;

export const scheduleIdSchema = z.uuid(ERRORS.SCHEDULE_ID_INVALID);
export const notificationIdSchema = z.uuid(ERRORS.NOTIFICATION_ID_INVALID);
export const scheduleStatusSchema = z.enum(SCHEDULE_STATUSES);

/** A date with a time. Date-only strings are refused: a reminder is an instant. */
const DATE_TIME_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * An absolute instant. Models write these in several shapes — with or without
 * seconds, `Z` or an offset — so the check is "a date-time the platform can
 * parse" and the stored form is always the normalised UTC `Z` string.
 */
const remindAt = z
  .string()
  .trim()
  .refine(
    (value) => DATE_TIME_PREFIX.test(value) && !Number.isNaN(Date.parse(value)),
    ERRORS.SCHEDULE_REMIND_AT_FORMAT,
  )
  .transform((value) => new Date(value).toISOString())
  .describe(
    'The absolute instant to notify at, ISO 8601 in UTC — "2026-09-11T09:00:00Z". ' +
      'Resolve "Friday morning" or "in two hours" against the current time given to ' +
      'you. It must be in the future, and a date alone is not enough.',
  );

/**
 * Only the shape is checked here. Whether the fields parse, ever fire, or fire
 * too often needs the cron library and a clock, so that lives in `lib/cron.ts`
 * and the service applies it.
 */
const cron = z
  .string()
  .trim()
  .max(100)
  .refine((value) => value.split(/\s+/).length === 5, ERRORS.SCHEDULE_CRON_INVALID)
  .describe(
    'A five-field cron expression evaluated in UTC: "0 9 * * 1" is every Monday at ' +
      '09:00, "0 18 * * *" every day at 18:00, "0 9 1 * *" the first of each month. ' +
      'It must not fire more often than every 15 minutes.',
  );

/** What `ScheduleService.scheduleOnce` and `.scheduleRecurring` accept. */
export const scheduleOnceSchema = z.object({ remind_at: remindAt });
export const scheduleRecurringSchema = z.object({ cron });

export type ScheduleOnceInput = z.input<typeof scheduleOnceSchema>;
export type ScheduleRecurringInput = z.input<typeof scheduleRecurringSchema>;

/**
 * Flat tool args, `id` being the task's, so the same middleware that checks
 * `update_task` has seen the id can check these.
 */
const scheduledTaskId = taskIdSchema.describe(TASK_ID_FROM_RESULT);

export const scheduleReminderToolSchema = z.object({
  id: scheduledTaskId,
  remind_at: remindAt,
});
export const scheduleRecurringToolSchema = z.object({ id: scheduledTaskId, cron });
export const cancelScheduleToolSchema = z.object({ id: scheduledTaskId });

const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(SCHED_LIST_LIMIT_MAX)
  .default(SCHED_LIST_LIMIT_DEFAULT);

/** Filters for GET /api/schedules. */
export const listSchedulesSchema = z.object({
  status: z.array(scheduleStatusSchema).min(1).optional(),
  limit,
});

/** Filters for GET /api/notifications. `acknowledged` arrives as a query string. */
export const listNotificationsSchema = z.object({
  acknowledged: z.union([z.boolean(), z.stringbool()]).optional(),
  limit,
});

export type ListSchedulesInput = z.input<typeof listSchedulesSchema>;
export type ListSchedulesFilters = z.output<typeof listSchedulesSchema>;
export type ListNotificationsInput = z.input<typeof listNotificationsSchema>;
export type ListNotificationsFilters = z.output<typeof listNotificationsSchema>;
