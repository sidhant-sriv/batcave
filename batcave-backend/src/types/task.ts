import type { ScheduleKind, ScheduleParams } from './schedule';

export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The active schedule on a task, reduced to what answers "when does this
 * notify me": the workflow bookkeeping — id, counts, status — belongs to the
 * Sched surface and `/api/schedules`, not to a task listing.
 */
export interface TaskScheduleSummary {
  kind: ScheduleKind;
  /** Five-field cron in UTC; null for a one-shot reminder. */
  cron: string | null;
  next_at: string;
}

/**
 * What a task search returns. `schedule` is null when the task notifies nobody,
 * and that distinction is the point: without it a list of tasks cannot answer
 * "which of these are scheduled" without a query per row.
 */
export type TaskWithSchedule = Task & { schedule: TaskScheduleSummary | null };

/** Bindings and secrets available on the Worker environment. */
export interface Env {
  DB: D1Database;
  /** The Workflow that sleeps for a schedule and writes its notifications. */
  TASK_SCHEDULE: Workflow<ScheduleParams>;
  /** Workers AI, used only to transcribe dictated messages. */
  AI: Ai;
  GROQ_API_KEY: string;
  GROQ_MODEL?: string;
  /** Comma-separated origins the browser frontend may call `/api/*` from. */
  CORS_ORIGINS?: string;
}
