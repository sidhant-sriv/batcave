import type { Task } from '../types/task';
import { ERRORS } from '../errors';
import type { SearchTasksFilters, UpdateTaskData } from '../schemas/task';

/**
 * D1 access for the tasks table. This is the only place that talks to the
 * database about tasks; services call in here, routes never do.
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
         (id, title, description, status, priority, due_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET id = id
       RETURNING *`,
    )
    .bind(
      task.id,
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

export async function selectTaskById(db: D1Database, id: string): Promise<Task | null> {
  const row = await db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<Task>();
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
  binds.push(updatedAt, id);

  const row = await db
    .prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ? RETURNING *`)
    .bind(...binds)
    .first<Task>();

  return row ?? null;
}

/** Split free text into the terms that must each match. */
export function searchTerms(query: string | null | undefined): string[] {
  if (!query) return [];
  return query.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TERMS);
}

/** `%`, `_` and `\` are LIKE metacharacters and have to survive as literals. */
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * Pure so it can be unit tested without D1. Every filter is optional and they
 * AND together; each free-text term must match the title or the description.
 * One extra row is requested so the caller can report truncation without a
 * second COUNT query.
 */
export function buildSearchQuery(filters: SearchTasksFilters): {
  sql: string;
  binds: unknown[];
} {
  const clauses: string[] = [];
  const binds: unknown[] = [];

  if (filters.status?.length) {
    clauses.push(`status IN (${filters.status.map(() => '?').join(', ')})`);
    binds.push(...filters.status);
  }

  if (filters.priority?.length) {
    clauses.push(`priority IN (${filters.priority.map(() => '?').join(', ')})`);
    binds.push(...filters.priority);
  }

  if (filters.due_from) {
    clauses.push('due_date >= ?');
    binds.push(filters.due_from);
  }

  if (filters.due_to) {
    clauses.push('due_date <= ?');
    binds.push(filters.due_to);
  }

  for (const term of searchTerms(filters.query)) {
    clauses.push(`(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')`);
    const pattern = likePattern(term);
    binds.push(pattern, pattern);
  }

  const where = clauses.length > 0 ? `\nWHERE ${clauses.join('\n  AND ')}` : '';
  binds.push(filters.limit + 1);

  return {
    sql:
      `SELECT * FROM tasks${where}\n` +
      `ORDER BY\n` +
      `  due_date IS NULL,\n` +
      `  due_date ASC,\n` +
      `  CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,\n` +
      `  created_at ASC\n` +
      `LIMIT ?`,
    binds,
  };
}

export async function searchTasks(
  db: D1Database,
  filters: SearchTasksFilters,
): Promise<{ tasks: Task[]; truncated: boolean }> {
  const { sql, binds } = buildSearchQuery(filters);
  const result = await db
    .prepare(sql)
    .bind(...binds)
    .all<Task>();

  const rows = result.results ?? [];
  return { tasks: rows.slice(0, filters.limit), truncated: rows.length > filters.limit };
}
