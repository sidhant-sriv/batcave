import { ERRORS } from '../errors';
import type {
  ListNotificationsFilters,
  ListSchedulesFilters,
} from '../schemas/schedule';
import type {
  Notification,
  NotificationWithTask,
  Schedule,
  ScheduleStatus,
  ScheduleWithTask,
} from '../types/schedule';
import type { Task } from '../types/task';

/**
 * D1 access for the two tables a schedule is made of: the schedule itself, and
 * the notifications it has produced. Both live here because neither is useful
 * without the other, the same reasoning as `db/chats.ts`.
 */

/**
 * A statement rather than an execution, so a replace can cancel the previous
 * schedule and insert this one in a single batch.
 */
export function insertScheduleStatement(db: D1Database, schedule: Schedule) {
  return db
    .prepare(
      `INSERT INTO schedules
         (id, task_id, kind, cron, next_at, status, notification_count, created_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET id = id
       RETURNING *`,
    )
    .bind(
      schedule.id,
      schedule.task_id,
      schedule.kind,
      schedule.cron,
      schedule.next_at,
      schedule.status,
      schedule.notification_count,
      schedule.created_at,
      schedule.ended_at,
    );
}

export async function insertSchedule(db: D1Database, schedule: Schedule): Promise<Schedule> {
  const row = await insertScheduleStatement(db, schedule).first<Schedule>();
  if (!row) throw new Error(ERRORS.SCHEDULE_INSERT_NO_ROW);
  return row;
}

export async function selectSchedule(db: D1Database, id: string): Promise<Schedule | null> {
  const row = await db.prepare('SELECT * FROM schedules WHERE id = ?').bind(id).first<Schedule>();
  return row ?? null;
}

/** The one schedule a task is allowed to have running, if it has one. */
export async function selectActiveScheduleForTask(
  db: D1Database,
  taskId: string,
): Promise<Schedule | null> {
  const row = await db
    .prepare(`SELECT * FROM schedules WHERE task_id = ? AND status = 'active'`)
    .bind(taskId)
    .first<Schedule>();
  return row ?? null;
}

/** Statement rather than execution, so a replace can cancel and insert in one batch. */
export const cancelScheduleStatement = (db: D1Database, id: string, at: string) =>
  db
    .prepare(
      `UPDATE schedules
          SET status = 'cancelled', ended_at = ?
        WHERE id = ? AND status = 'active'`,
    )
    .bind(at, id);

/** Null when the schedule was not active, which the service reports as not found. */
export async function cancelSchedule(
  db: D1Database,
  id: string,
  at: string,
): Promise<Schedule | null> {
  const row = await db
    .prepare(
      `UPDATE schedules
          SET status = 'cancelled', ended_at = ?
        WHERE id = ? AND status = 'active'
      RETURNING *`,
    )
    .bind(at, id)
    .first<Schedule>();
  return row ?? null;
}

/**
 * Moves a schedule past a firing.
 *
 * `notification_count = ?` guarded by `notification_count = ? - 1` is what makes
 * a retried workflow step a no-op: the second attempt finds the count already
 * advanced and changes nothing, where a blind `+ 1` would skip an occurrence.
 */
export function advanceScheduleStatement(
  db: D1Database,
  id: string,
  advance: { count: number; nextAt: string; status: ScheduleStatus; endedAt: string | null },
) {
  return db
    .prepare(
      `UPDATE schedules
          SET notification_count = ?, next_at = ?, status = ?, ended_at = ?
        WHERE id = ? AND status = 'active' AND notification_count = ?`,
    )
    .bind(
      advance.count,
      advance.nextAt,
      advance.status,
      advance.endedAt,
      id,
      advance.count - 1,
    );
}

/**
 * Upsert, for the same reason `insertTask` is one: a workflow step that is
 * retried after its write committed must land on the row it already wrote.
 * The id is derived from the schedule and the sequence number, so it does.
 */
export function insertNotificationStatement(db: D1Database, notification: Notification) {
  return db
    .prepare(
      `INSERT INTO notifications
         (id, schedule_id, task_id, seq, notified_at, outcome, reopened, acknowledged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET id = id`,
    )
    .bind(
      notification.id,
      notification.schedule_id,
      notification.task_id,
      notification.seq,
      notification.notified_at,
      notification.outcome,
      notification.reopened,
      notification.acknowledged_at,
    );
}

/** Null when it was already acknowledged, so a double dismiss is not an error twice. */
export async function acknowledgeNotification(
  db: D1Database,
  id: string,
  at: string,
): Promise<Notification | null> {
  const row = await db
    .prepare(
      `UPDATE notifications
          SET acknowledged_at = ?
        WHERE id = ? AND acknowledged_at IS NULL
      RETURNING *`,
    )
    .bind(at, id)
    .first<Notification>();
  return row ?? null;
}

/**
 * Both lists join their task in, because every row on the Sched surface renders
 * as a task row and a second query per row would be the obvious way to make
 * that page slow. Columns are aliased rather than selected with `t.*`: two
 * tables that both have `id`, `task_id` and `created_at` would otherwise
 * collide in the flat row D1 returns.
 */
const TASK_COLUMNS = [
  't.id AS t_id',
  't.title AS t_title',
  't.description AS t_description',
  't.status AS t_status',
  't.priority AS t_priority',
  't.due_date AS t_due_date',
  't.created_at AS t_created_at',
  't.updated_at AS t_updated_at',
].join(', ');

type TaskColumns = { [K in keyof Task as `t_${K}`]: Task[K] };

function splitTask<T>(row: T & TaskColumns): T & { task: Task } {
  const {
    t_id,
    t_title,
    t_description,
    t_status,
    t_priority,
    t_due_date,
    t_created_at,
    t_updated_at,
    ...rest
  } = row;

  return {
    ...(rest as unknown as T),
    task: {
      id: t_id,
      title: t_title,
      description: t_description,
      status: t_status,
      priority: t_priority,
      due_date: t_due_date,
      created_at: t_created_at,
      updated_at: t_updated_at,
    },
  };
}

/** One extra row is asked for, so `truncated` costs no second COUNT. */
export async function listSchedules(
  db: D1Database,
  filters: ListSchedulesFilters,
): Promise<{ schedules: ScheduleWithTask[]; truncated: boolean }> {
  const where = filters.status?.length
    ? `WHERE s.status IN (${filters.status.map(() => '?').join(', ')})`
    : '';

  const { results } = await db
    .prepare(
      `SELECT s.*, ${TASK_COLUMNS}
         FROM schedules s
         JOIN tasks t ON t.id = s.task_id
        ${where}
        ORDER BY s.next_at ASC, s.id ASC
        LIMIT ?`,
    )
    .bind(...(filters.status ?? []), filters.limit + 1)
    .all<Schedule & TaskColumns>();

  const rows = results.map(splitTask);
  return { schedules: rows.slice(0, filters.limit), truncated: rows.length > filters.limit };
}

/**
 * Unacknowledged first and newest within each group: the inbox reading order.
 * `acknowledged_at IS NOT NULL` sorts 0 before 1, so unseen notifications lead.
 */
export async function listNotifications(
  db: D1Database,
  filters: ListNotificationsFilters,
): Promise<{ notifications: NotificationWithTask[]; truncated: boolean }> {
  const where =
    filters.acknowledged === undefined
      ? ''
      : `WHERE n.acknowledged_at IS ${filters.acknowledged ? 'NOT NULL' : 'NULL'}`;

  const { results } = await db
    .prepare(
      `SELECT n.*, ${TASK_COLUMNS}
         FROM notifications n
         JOIN tasks t ON t.id = n.task_id
        ${where}
        ORDER BY n.acknowledged_at IS NOT NULL, n.notified_at DESC, n.id DESC
        LIMIT ?`,
    )
    .bind(filters.limit + 1)
    .all<Notification & TaskColumns>();

  const rows = results.map(splitTask);
  return {
    notifications: rows.slice(0, filters.limit),
    truncated: rows.length > filters.limit,
  };
}
