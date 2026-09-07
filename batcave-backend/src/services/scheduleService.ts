import type { Actor } from '../actor';
import {
  acknowledgeNotification,
  advanceScheduleStatement,
  cancelSchedule,
  cancelScheduleStatement,
  insertNotificationStatement,
  insertSchedule,
  insertScheduleStatement,
  listNotifications,
  listSchedules,
  selectActiveScheduleForTask,
  selectSchedule,
} from '../db/schedules';
import { reopenTaskStatement, selectTaskById } from '../db/tasks';
import { ERRORS } from '../errors';
import { derivedUuid, uuidv7 } from '../ids';
import { parseCron } from '../lib/cron';
import {
  listNotificationsSchema,
  listSchedulesSchema,
  notificationIdSchema,
  scheduleIdSchema,
  scheduleOnceSchema,
  scheduleRecurringSchema,
  type ListNotificationsInput,
  type ListSchedulesInput,
  type ScheduleOnceInput,
  type ScheduleRecurringInput,
} from '../schemas/schedule';
import { taskIdSchema } from '../schemas/task';
import type {
  Notification,
  NotificationOutcome,
  NotificationWithTask,
  Schedule,
  ScheduleParams,
  ScheduleWithTask,
} from '../types/schedule';
import { TaskNotFoundError } from './taskService';

/** Thrown when input fails validation inside the service. */
export class ScheduleValidationError extends Error {
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = 'ScheduleValidationError';
  }
}

/** Thrown when there is no active schedule, or no such schedule id. */
export class ScheduleNotFoundError extends Error {
  constructor(readonly id: string) {
    super(ERRORS.SCHEDULE_NOT_FOUND);
    this.name = 'ScheduleNotFoundError';
  }
}

/** Thrown when a notification does not exist, or was already acknowledged. */
export class NotificationNotFoundError extends Error {
  constructor(readonly id: string) {
    super(ERRORS.NOTIFICATION_NOT_FOUND);
    this.name = 'NotificationNotFoundError';
  }
}

const YEAR_MS = 365 * 24 * 60 * 60_000;

/**
 * A recurring schedule runs until cancelled, which is a long time to trust a
 * loop. Two independent brakes: a count, and a horizon measured from when the
 * schedule was created. Either one ends it, and the row says so.
 */
export const MAX_NOTIFICATIONS = 1000;

const NOTIFICATION_ID_NAMESPACE = 'batcave:notification';

/** Derived, so a retried workflow step upserts its own row rather than a second one. */
export const notificationId = (scheduleId: string, seq: number): Promise<string> =>
  derivedUuid(NOTIFICATION_ID_NAMESPACE, `${scheduleId}:${seq}`);

/** What the workflow learns before it sleeps. */
export type PlanResult = { stop: true } | { stop: false; nextAt: string };

/** What the workflow learns after it wakes. */
export interface NotifyResult {
  stop: boolean;
  outcome: NotificationOutcome | 'ignored';
}

/**
 * Single source of truth for schedules and the notifications they produce.
 *
 * The division of labour with the Workflow is the whole design: the instance
 * owns *when*, this service owns *what*. Every decision — whether to fire,
 * whether to stop, what the next occurrence is — is made here against D1, so
 * cancelling a schedule is a row update rather than a message to a sleeping
 * instance, and an instance that outlives its row simply finds nothing to do.
 *
 * Imports nothing from `agent/`, like `TaskService`.
 *
 * The only service that takes an `Actor` rather than a login, because it has
 * the only caller that acts for nobody: the Workflow wakes on a schedule its
 * user created hours or weeks earlier, with no request to carry an identity on,
 * and passes `SYSTEM`. Every other construction names a person.
 */
export class ScheduleService {
  constructor(
    private readonly db: D1Database,
    private readonly workflow: Workflow<ScheduleParams>,
    private readonly owner: Actor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * A one-shot reminder at an absolute instant.
   *
   * `opts.id` lets the agent supply an id derived from the tool call, so a
   * retried tool call resumes the schedule it already created instead of
   * starting a second one.
   */
  async scheduleOnce(
    taskId: string,
    input: ScheduleOnceInput,
    opts?: { id?: string },
  ): Promise<{ schedule: Schedule; replaced: Schedule | null }> {
    const parsed = scheduleOnceSchema.safeParse(input);
    if (!parsed.success) {
      throw new ScheduleValidationError(ERRORS.INVALID_SCHEDULE_INPUT, parsed.error.issues);
    }

    const now = this.now();
    const at = Date.parse(parsed.data.remind_at);
    if (at <= now.getTime()) throw new ScheduleValidationError(ERRORS.SCHEDULE_IN_PAST);
    if (at > now.getTime() + YEAR_MS) throw new ScheduleValidationError(ERRORS.SCHEDULE_TOO_FAR);

    return this.create({
      taskId,
      id: opts?.id,
      kind: 'once',
      cron: null,
      nextAt: parsed.data.remind_at,
      // A one-shot never changes the task, so setting one on finished work
      // would notify about something there is nothing left to do about.
      requireOpenTask: true,
    });
  }

  /** A recurring schedule, described by a five-field UTC cron. */
  async scheduleRecurring(
    taskId: string,
    input: ScheduleRecurringInput,
    opts?: { id?: string },
  ): Promise<{ schedule: Schedule; replaced: Schedule | null }> {
    const parsed = scheduleRecurringSchema.safeParse(input);
    if (!parsed.success) {
      throw new ScheduleValidationError(ERRORS.INVALID_SCHEDULE_INPUT, parsed.error.issues);
    }

    const now = this.now();
    const cron = parseCron(parsed.data.cron, now);
    if (!cron.ok) throw new ScheduleValidationError(cron.error);

    const next = cron.schedule.nextRun(now);
    if (!next) throw new ScheduleValidationError(ERRORS.SCHEDULE_CRON_NO_RUN);

    return this.create({
      taskId,
      id: opts?.id,
      kind: 'recurring',
      cron: parsed.data.cron,
      nextAt: next.toISOString(),
      // A recurring schedule on a finished task is meaningful: the first
      // firing reopens it, which is what makes it a resettable checklist item.
      requireOpenTask: false,
    });
  }

  /**
   * The shared write path. Order matters: the row is written before the
   * instance exists, because a row with no clock is repairable by a retry
   * while an instance with no row would fire against nothing.
   */
  private async create(params: {
    taskId: string;
    id?: string;
    kind: Schedule['kind'];
    cron: string | null;
    nextAt: string;
    requireOpenTask: boolean;
  }): Promise<{ schedule: Schedule; replaced: Schedule | null }> {
    const taskId = this.validTaskId(params.taskId);
    const id = params.id ?? uuidv7();

    // A retried tool call arrives with an id that may already be a schedule.
    // Returning it — rather than replacing again — is what stops a retry from
    // cancelling the very row it is retrying.
    const existing = await selectSchedule(this.db, id, this.owner);
    if (existing) {
      await this.ensureInstance(id);
      return { schedule: existing, replaced: null };
    }

    // The ownership check for the whole scheduling path: a task that is not
    // this caller's does not resolve, so there is nothing to hang a schedule on.
    const task = await selectTaskById(this.db, taskId, this.owner);
    if (!task) throw new TaskNotFoundError(taskId);
    if (params.requireOpenTask && task.status === 'done') {
      throw new ScheduleValidationError(ERRORS.SCHEDULE_TASK_DONE);
    }

    const now = this.now().toISOString();
    const schedule: Schedule = {
      id,
      task_id: taskId,
      kind: params.kind,
      cron: params.cron,
      next_at: params.nextAt,
      status: 'active',
      notification_count: 0,
      created_at: now,
      ended_at: null,
    };

    // One schedule per task. The partial unique index would refuse the insert
    // anyway; cancelling in the same batch is what turns that into a replace.
    const replaced = await selectActiveScheduleForTask(this.db, taskId, this.owner);
    if (replaced) {
      await this.db.batch([
        cancelScheduleStatement(this.db, replaced.id, now),
        insertScheduleStatement(this.db, schedule),
      ]);
    } else {
      await insertSchedule(this.db, schedule);
    }

    await this.ensureInstance(id);
    if (replaced) await this.terminate(replaced.id);

    return { schedule, replaced };
  }

  /**
   * Starts the clock, tolerating the case where it is already running.
   *
   * A retried tool call re-derives the same instance id, and `create` refuses a
   * duplicate. `get` resolving proves that is what happened; anything else is a
   * real failure and is rethrown, so the escalate middleware can take it out of
   * the graph as a 503 rather than laundering it into a chat apology.
   */
  private async ensureInstance(id: string): Promise<void> {
    try {
      await this.workflow.create({ id, params: { scheduleId: id } });
    } catch (error) {
      try {
        await this.workflow.get(id);
      } catch {
        throw error;
      }
    }
  }

  /**
   * Best effort, and deliberately so. A terminated instance is an optimisation:
   * one that survives wakes up, reads a row that is no longer active, and stops
   * on its own. Failing to terminate must never fail the request that cancelled.
   */
  private async terminate(id: string): Promise<void> {
    try {
      const instance = await this.workflow.get(id);
      await instance.terminate();
    } catch (error) {
      console.warn(`Could not terminate schedule instance ${id}:`, error);
    }
  }

  /** The tool's cancel: addressed by task, because that is what the model has. */
  async cancelForTask(taskId: string): Promise<Schedule> {
    const id = this.validTaskId(taskId);
    const active = await selectActiveScheduleForTask(this.db, id, this.owner);
    if (!active) throw new ScheduleNotFoundError(id);

    return this.cancel(active.id);
  }

  /** The REST cancel: addressed by schedule id. */
  async cancel(scheduleId: string): Promise<Schedule> {
    const id = this.validScheduleId(scheduleId);
    const row = await cancelSchedule(this.db, id, this.now().toISOString(), this.owner);
    if (!row) throw new ScheduleNotFoundError(id);

    await this.terminate(id);
    return row;
  }

  async acknowledge(notificationId: string): Promise<Notification> {
    const parsed = notificationIdSchema.safeParse(notificationId);
    if (!parsed.success) {
      throw new ScheduleValidationError(ERRORS.NOTIFICATION_ID_INVALID, parsed.error.issues);
    }

    const row = await acknowledgeNotification(
      this.db,
      parsed.data,
      this.now().toISOString(),
      this.owner,
    );
    if (!row) throw new NotificationNotFoundError(parsed.data);
    return row;
  }

  async listSchedules(
    input: ListSchedulesInput = {},
  ): Promise<{ schedules: ScheduleWithTask[]; truncated: boolean }> {
    const parsed = listSchedulesSchema.safeParse(input);
    if (!parsed.success) {
      throw new ScheduleValidationError(ERRORS.INVALID_SCHEDULE_LIST, parsed.error.issues);
    }

    return listSchedules(this.db, parsed.data, this.owner);
  }

  async listNotifications(
    input: ListNotificationsInput = {},
  ): Promise<{ notifications: NotificationWithTask[]; truncated: boolean }> {
    const parsed = listNotificationsSchema.safeParse(input);
    if (!parsed.success) {
      throw new ScheduleValidationError(ERRORS.INVALID_NOTIFICATION_LIST, parsed.error.issues);
    }

    return listNotifications(this.db, parsed.data, this.owner);
  }

  /**
   * What the workflow asks before each sleep. Reading the row every time is
   * what makes a cancel take effect without reaching the instance: a schedule
   * that is no longer active stops the loop here.
   */
  async plan(scheduleId: string): Promise<PlanResult> {
    const schedule = await selectSchedule(this.db, scheduleId, this.owner);
    if (!schedule || schedule.status !== 'active') return { stop: true };

    return { stop: false, nextAt: schedule.next_at };
  }

  /**
   * One firing.
   *
   * Every write for a firing goes in one batch, so a step that is retried after
   * a partial failure cannot leave a notification without its advance, or a
   * reopened task without a notification explaining why it came back.
   */
  async notify(scheduleId: string, seq: number): Promise<NotifyResult> {
    const schedule = await selectSchedule(this.db, scheduleId, this.owner);
    // Cancelled while the instance slept, and the terminate did not land.
    if (!schedule || schedule.status !== 'active') return { stop: true, outcome: 'ignored' };

    const task = await selectTaskById(this.db, schedule.task_id, this.owner);
    // The task was deleted. The cascade removes the schedule with it, so this
    // is only reachable in a race; ending the loop is the honest response.
    if (!task) return { stop: true, outcome: 'ignored' };

    const now = this.now();
    const at = now.toISOString();
    const id = await notificationId(scheduleId, seq);
    const open = task.status !== 'done';

    const writes: D1PreparedStatement[] = [];
    let outcome: NotificationOutcome;
    let stop: boolean;
    let nextAt = schedule.next_at;
    let status: Schedule['status'];

    if (schedule.kind === 'once') {
      // Nothing to be reminded about any more, but the firing is still recorded:
      // a reminder that silently evaporated would be indistinguishable from one
      // that never ran.
      outcome = open ? 'notified' : 'skipped';
      status = 'ended';
      stop = true;
    } else {
      outcome = 'notified';

      // Computed from the actual firing time rather than the planned one, so an
      // instance that wakes late skips the occurrences it slept through instead
      // of firing a burst to catch up.
      const cron = parseCron(schedule.cron ?? '', now);
      const next = cron.ok ? cron.schedule.nextRun(now) : null;
      const exhausted =
        schedule.notification_count + 1 >= MAX_NOTIFICATIONS ||
        Date.parse(schedule.created_at) + YEAR_MS < (next?.getTime() ?? Infinity);

      status = next && !exhausted ? 'active' : 'ended';
      nextAt = next ? next.toISOString() : schedule.next_at;
      stop = status === 'ended';

      if (!open) writes.push(reopenTaskStatement(this.db, task.id, at, this.owner));
    }

    const notification: Notification = {
      id,
      schedule_id: scheduleId,
      task_id: task.id,
      seq,
      notified_at: at,
      outcome,
      reopened: schedule.kind === 'recurring' && !open ? 1 : 0,
      acknowledged_at: null,
    };

    await this.db.batch([
      insertNotificationStatement(this.db, notification),
      advanceScheduleStatement(this.db, scheduleId, {
        count: seq,
        nextAt,
        status,
        endedAt: status === 'ended' ? at : null,
      }),
      ...writes,
    ]);

    return { stop, outcome };
  }

  private validTaskId(taskId: string): string {
    const parsed = taskIdSchema.safeParse(taskId);
    if (!parsed.success) {
      throw new ScheduleValidationError(ERRORS.TASK_ID_INVALID, parsed.error.issues);
    }
    return parsed.data;
  }

  private validScheduleId(scheduleId: string): string {
    const parsed = scheduleIdSchema.safeParse(scheduleId);
    if (!parsed.success) {
      throw new ScheduleValidationError(ERRORS.SCHEDULE_ID_INVALID, parsed.error.issues);
    }
    return parsed.data;
  }
}
