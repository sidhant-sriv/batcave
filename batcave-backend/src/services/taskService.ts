import {
  insertTask,
  searchTasks,
  selectTaskById,
  updateTask,
} from '../db/tasks';
import { ERRORS } from '../errors';
import { uuidv7 } from '../ids';
import {
  createTaskSchema,
  searchTasksSchema,
  taskIdSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type SearchTasksInput,
  type UpdateTaskInput,
} from '../schemas/task';
import type { Task, TaskWithSchedule } from '../types/task';

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

/** Thrown when an update targets an id that is not in the table. */
export class TaskNotFoundError extends Error {
  constructor(readonly id: string) {
    super(ERRORS.TASK_NOT_FOUND);
    this.name = 'TaskNotFoundError';
  }
}

/**
 * Single source of truth for reading and writing tasks. Every caller — the
 * REST routes and the agent tools alike — goes through here, so defaults,
 * generated ids and timestamps stay consistent. It validates on entry even
 * though callers already did, so it stays safe to call from anywhere, and it
 * imports nothing from `agent/`.
 *
 * Constructed with the login whose tasks it may touch, so no method can be
 * called without having answered that question. There is no `SYSTEM` variant
 * here on purpose: nothing in this codebase reads or writes a task without a
 * person behind the request, and the one caller that comes close — the
 * Workflow reopening a task its schedule fired on — goes through
 * `ScheduleService`, which does take an `Actor`.
 */
export class TaskService {
  constructor(
    private readonly db: D1Database,
    private readonly owner: string,
  ) {}

  /**
   * `opts.id` lets the agent supply an id derived from the tool call, so a
   * retried tool call upserts the same row instead of creating a second task.
   * The REST route has nothing to derive from and gets a generated one.
   */
  async create(input: CreateTaskInput, opts?: { id?: string }): Promise<Task> {
    const parsed = createTaskSchema.safeParse(input);
    if (!parsed.success) {
      throw new TaskValidationError(ERRORS.INVALID_TASK_INPUT, parsed.error.issues);
    }

    const now = new Date().toISOString();
    const task: Task = {
      id: opts?.id ?? uuidv7(),
      user_id: this.owner,
      title: parsed.data.title,
      description: parsed.data.description,
      status: 'todo',
      priority: parsed.data.priority,
      due_date: parsed.data.due_date,
      created_at: now,
      updated_at: now,
    };

    return insertTask(this.db, task);
  }

  async getById(id: string): Promise<Task | null> {
    return selectTaskById(this.db, id, this.owner);
  }

  /** Results carry the task's active schedule, so a caller can tell what notifies. */
  async search(
    input: SearchTasksInput,
  ): Promise<{ tasks: TaskWithSchedule[]; truncated: boolean }> {
    const parsed = searchTasksSchema.safeParse(input);
    if (!parsed.success) {
      throw new TaskValidationError(ERRORS.INVALID_SEARCH_FILTERS, parsed.error.issues);
    }

    return searchTasks(this.db, parsed.data, this.owner);
  }

  /** Throws TaskNotFoundError when the id does not exist. */
  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const parsedId = taskIdSchema.safeParse(id);
    if (!parsedId.success) {
      throw new TaskValidationError(ERRORS.TASK_ID_INVALID, parsedId.error.issues);
    }

    const parsed = updateTaskSchema.safeParse(input);
    if (!parsed.success) {
      throw new TaskValidationError(ERRORS.INVALID_TASK_INPUT, parsed.error.issues);
    }

    // A task belonging to someone else matches nothing and is reported as
    // missing, not forbidden: whether an id exists is not a stranger's business.
    const row = await updateTask(
      this.db,
      parsedId.data,
      parsed.data,
      new Date().toISOString(),
      this.owner,
    );
    if (!row) {
      throw new TaskNotFoundError(parsedId.data);
    }

    return row;
  }
}
