import type { ScheduleParams } from './schedule';

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

/** Bindings and secrets available on the Worker environment. */
export interface Env {
  DB: D1Database;
  /** The Workflow that sleeps for a schedule and writes its notifications. */
  TASK_SCHEDULE: Workflow<ScheduleParams>;
  GROQ_API_KEY: string;
  GROQ_MODEL?: string;
  /** Comma-separated origins the browser frontend may call `/api/*` from. */
  CORS_ORIGINS?: string;
}
