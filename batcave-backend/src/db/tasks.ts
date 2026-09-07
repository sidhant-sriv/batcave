import type { Actor } from '../actor';
import type { Task, TaskScheduleSummary, TaskWithSchedule } from '../types/task';
import { ERRORS } from '../errors';
import type { SearchTasksFilters, UpdateTaskData } from '../schemas/task';
import { and, ownerClause } from './owner';

/**
 * D1 access for the tasks table. This is the only place that talks to the
 * database about tasks; services call in here, routes never do.
 *
 * Every function here takes the owner, and takes it as a required argument
 * rather than reading it from somewhere ambient. That is deliberate: a query
 * that forgets to scope itself should not compile.
 */

/** More terms than this stop narrowing the result and only cost a scan. */
const MAX_SEARCH_TERMS = 5;

/** Columns an update may set. The id and timestamps are never caller-supplied. */
const UPDATABLE_COLUMNS = ['title', 'description', 'status', 'priority', 'due_date'] as const;

/**
 * Insert, or return the row that is already there. The agent derives task ids
 * from the tool call that created them, so a retried tool call arrives with an
 * id that may already exist; `DO UPDATE SET id = id` is a deliberate no-op that
 * still yields a row from RETURNING, where DO NOTHING would look like a failure.
 */
export async function insertTask(db: D1Database, task: Task): Promise<Task> {
  const row = await db
    .prepare(
      `INSERT INTO tasks
         (id, user_id, title, description, status, priority, due_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET id = id
       RETURNING *`,
    )
    .bind(
      task.id,
      task.user_id,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.due_date,
      task.created_at,
      task.updated_at,
    )
    .first<Task>();

  if (!row) {
    throw new Error(ERRORS.TASK_INSERT_NO_ROW);
  }

  return row;
}

export async function selectTaskById(
  db: D1Database,
  id: string,
  owner: Actor,
): Promise<Task | null> {
  const scope = ownerClause(owner);
  const row = await db
    .prepare(`SELECT * FROM tasks WHERE id = ?${and(scope)}`)
    .bind(id, ...scope.binds)
    .first<Task>();
  return row ?? null;
}

/**
 * Update a whitelisted set of columns. Returns null when no row matched, which
 * the service turns into TaskNotFoundError.
 */
export async function updateTask(
  db: D1Database,
  id: string,
  changes: UpdateTaskData,
  updatedAt: string,
  owner: Actor,
): Promise<Task | null> {
  const assignments: string[] = [];
  const binds: unknown[] = [];

  for (const column of UPDATABLE_COLUMNS) {
    const value = changes[column];
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    binds.push(value);
  }

  assignments.push('updated_at = ?');
  const scope = ownerClause(owner);
  binds.push(updatedAt, id, ...scope.binds);

  const row = await db
    .prepare(
      `UPDATE tasks SET ${assignments.join(', ')} WHERE id = ?${and(scope)} RETURNING *`,
    )
    .bind(...binds)
    .first<Task>();

  return row ?? null;
}

/**
 * Puts a finished task back on the list. Only a recurring schedule calls this,
 * when its firing finds the task already done: the schedule is the statement
 * that the work comes round again, so the row goes back to `todo` rather than a
 * second task being created beside it.
 *
 * Guarded on `status = 'done'` so a firing on an open task writes nothing at
 * all, which is what keeps `updated_at` honest.
 *
 * Takes an `Actor` rather than a login because the only caller that reaches a
 * live schedule is the Workflow, which fires for a user who is not there.
 */
export function reopenTaskStatement(
  db: D1Database,
  id: string,
  updatedAt: string,
  owner: Actor,
) {
  const scope = ownerClause(owner);
  return db
    .prepare(
      `UPDATE tasks SET status = 'todo', updated_at = ?` +
        ` WHERE id = ? AND status = 'done'${and(scope)}`,
    )
    .bind(updatedAt, id, ...scope.binds);
}

/** Split free text into the terms that must each match. */
export function searchTerms(query: string | null | undefined): string[] {
  if (!query) return [];
  return query.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TERMS);
}

/** `%`, `_` and `\` are LIKE metacharacters and have to survive as literals. */
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * The active schedule, joined in rather than fetched per row. A task listing
 * that cannot say which rows notify the user forces the agent to answer
 * "what is scheduled?" from due dates, which are a different thing entirely.
 * The partial unique index on `(task_id) WHERE status = 'active'` is what keeps
 * this join from multiplying rows.
 */
const SCHEDULE_JOIN =
  "LEFT JOIN schedules s ON s.task_id = t.id AND s.status = 'active'";

/** Only the three columns that describe when it fires; aliased so `t.*` is safe. */
const SCHEDULE_COLUMNS = 's.kind AS s_kind, s.cron AS s_cron, s.next_at AS s_next_at';

type ScheduleColumns = {
  s_kind: TaskScheduleSummary['kind'] | null;
  s_cron: string | null;
  s_next_at: string | null;
};

/** A left join yields nulls for a task with no active schedule; that is the answer. */
function splitSchedule(row: Task & ScheduleColumns): TaskWithSchedule {
  const { s_kind, s_cron, s_next_at, ...task } = row;

  return {
    ...task,
    schedule:
      s_kind === null || s_next_at === null
        ? null
        : { kind: s_kind, cron: s_cron, next_at: s_next_at },
  };
}

/**
 * Pure so it can be unit tested without D1. Every filter is optional and they
 * AND together; each free-text term must match the title or the description.
 * Columns are qualified because the schedule join brings a second `status`,
 * `created_at` and `id` into scope. One extra row is requested so the caller
 * can report truncation without a second COUNT query.
 */
export function buildSearchQuery(
  filters: SearchTasksFilters,
  owner: Actor,
): {
  sql: string;
  binds: unknown[];
} {
  // First, so `idx_tasks_owner_status` and `idx_tasks_owner_due` are usable and
  // so the predicate that matters most is impossible to miss when reading the
  // generated SQL.
  const scope = ownerClause(owner, 't.user_id');
  const clauses: string[] = scope.sql ? [scope.sql] : [];
  const binds: unknown[] = [...scope.binds];

  if (filters.status?.length) {
    clauses.push(`t.status IN (${filters.status.map(() => '?').join(', ')})`);
    binds.push(...filters.status);
  }

  if (filters.priority?.length) {
    clauses.push(`t.priority IN (${filters.priority.map(() => '?').join(', ')})`);
    binds.push(...filters.priority);
  }

  if (filters.due_from) {
    clauses.push('t.due_date >= ?');
    binds.push(filters.due_from);
  }

  if (filters.due_to) {
    clauses.push('t.due_date <= ?');
    binds.push(filters.due_to);
  }

  // Presence of the joined row, not a column of the task: a schedule lives in
  // its own table, so "is it scheduled" is answered by whether the join matched.
  if (filters.scheduled !== undefined) {
    clauses.push(filters.scheduled ? 's.id IS NOT NULL' : 's.id IS NULL');
  }

  for (const term of searchTerms(filters.query)) {
    clauses.push(`(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')`);
    const pattern = likePattern(term);
    binds.push(pattern, pattern);
  }

  const where = clauses.length > 0 ? `\nWHERE ${clauses.join('\n  AND ')}` : '';
  binds.push(filters.limit + 1);

  return {
    sql:
      `SELECT t.*, ${SCHEDULE_COLUMNS}\n` +
      `FROM tasks t\n` +
      `${SCHEDULE_JOIN}${where}\n` +
      `ORDER BY\n` +
      `  t.due_date IS NULL,\n` +
      `  t.due_date ASC,\n` +
      `  CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,\n` +
      `  t.created_at ASC\n` +
      `LIMIT ?`,
    binds,
  };
}

export async function searchTasks(
  db: D1Database,
  filters: SearchTasksFilters,
  owner: Actor,
): Promise<{ tasks: TaskWithSchedule[]; truncated: boolean }> {
  const { sql, binds } = buildSearchQuery(filters, owner);
  const result = await db
    .prepare(sql)
    .bind(...binds)
    .all<Task & ScheduleColumns>();

  const rows = (result.results ?? []).map(splitSchedule);
  return { tasks: rows.slice(0, filters.limit), truncated: rows.length > filters.limit };
}
