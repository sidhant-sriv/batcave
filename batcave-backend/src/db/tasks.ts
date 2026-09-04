import type { Task } from '../types/task';
import { ERRORS } from '../errors';

/**
 * D1 access for the tasks table. This is the only place that talks to the
 * database; services call in here, routes never do.
 */
export async function insertTask(db: D1Database, task: Task): Promise<Task> {
  const row = await db
    .prepare(
      `INSERT INTO tasks
         (id, title, description, status, priority, due_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
