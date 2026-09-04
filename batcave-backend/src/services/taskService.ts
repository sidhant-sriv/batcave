import id from 'zod/v4/locales/id.js';
import { insertTask } from '../db/tasks';
import { ERRORS } from '../errors';
import { createTaskSchema, type CreateTaskInput } from '../schemas/task';
import type { Task } from '../types/task';

/** Thrown when input fails validation inside the service. */
export class TaskValidationError extends Error {
  constructor(
    message: string,
    readonly issues: unknown,
  ) {
    super(message);
    this.name = 'TaskValidationError';
  }
}

/**
 * Single source of truth for writing tasks. Every caller — the REST route and
 * the Groq agent alike — goes through here, so defaults, generated ids and
 * timestamps stay consistent.
 */
export class TaskService {
  constructor(private readonly db: D1Database) {}

  async create(input: CreateTaskInput): Promise<Task> {
    const parsed = createTaskSchema.safeParse(input);
    if (!parsed.success) {
      throw new TaskValidationError(ERRORS.INVALID_TASK_INPUT, parsed.error.issues);
    }

    const now = new Date().toISOString();
    const task: Task = {
      id: crypto.randomUUID(),
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      status: 'todo',
      priority: parsed.data.priority,
      due_date: parsed.data.due_date ?? null,
      created_at: now,
      updated_at: now,
    };

    return insertTask(this.db, task);
  }

  async getAll(): Promise<Task[]> {
    const result = await this.db.prepare('SELECT * FROM tasks').all<Task>();
    return result.results ?? [];
  }

  async getById(id: string): Promise<Task | null> {
    const result = await this.db.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<Task>();
    return result ?? null;
  }
}
  