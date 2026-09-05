import { queryString, request } from './client';
import type {
  CreateTaskInput,
  Task,
  TaskFilters,
  TaskListResponse,
  TaskResponse,
  UpdateTaskInput,
} from './types';

/**
 * The deterministic task surface. Ordering is fixed server-side — dated first,
 * then due date ascending, then priority, then age — so there is no sort
 * parameter to pass and none is invented here.
 */

/** The backend's own maximum. Asking for more is a 400. */
export const TASK_LIMIT_MAX = 100;

export async function listTasks(filters: TaskFilters = {}): Promise<TaskListResponse> {
  return request<TaskListResponse>(`/api/tasks${queryString({ ...filters })}`);
}

export async function getTask(id: string): Promise<Task> {
  const { task } = await request<TaskResponse>(`/api/tasks/${id}`);
  return task;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const { task } = await request<TaskResponse>('/api/tasks', {
    method: 'POST',
    body: input,
  });
  return task;
}

/**
 * Only ever send keys that actually changed. The backend rejects unknown keys
 * outright, and an explicit `null` is a clear instruction rather than a
 * no-change — see `changedFields` below, which is what callers should use.
 */
export async function updateTask(id: string, changes: UpdateTaskInput): Promise<Task> {
  const { task } = await request<TaskResponse>(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: changes,
  });
  return task;
}

/**
 * The diff between a task as loaded and as edited, in the shape PATCH wants.
 *
 * Two rules the backend imposes and this encodes once, so no form has to
 * remember them: an unchanged field is omitted entirely, and clearing a
 * nullable field means sending an explicit `null` rather than `""`.
 *
 * Returns `null` when nothing changed, which callers use to skip the request —
 * the backend would reject an empty body anyway.
 */
export function changedFields(original: Task, edited: UpdateTaskInput): UpdateTaskInput | null {
  const changes: UpdateTaskInput = {};

  if (edited.title !== undefined && edited.title !== original.title) {
    changes.title = edited.title;
  }
  if (edited.status !== undefined && edited.status !== original.status) {
    changes.status = edited.status;
  }
  if (edited.priority !== undefined && edited.priority !== original.priority) {
    changes.priority = edited.priority;
  }

  // Nullable text: "" from an emptied input means clear, which is `null`.
  for (const key of ['description', 'due_date'] as const) {
    if (edited[key] === undefined) continue;
    const next = edited[key] === '' ? null : edited[key];
    if (next !== original[key]) changes[key] = next;
  }

  return Object.keys(changes).length > 0 ? changes : null;
}
