/**
 * The wire contract, mirrored from the backend.
 *
 * These types are hand-written rather than generated because the backend owns
 * them and they are small enough that a drift is caught by the first request.
 * Each block names the file it mirrors, so a backend change has an obvious
 * landing site here.
 */

/* --- Tasks — batcave-backend/src/types/task.ts --------------------------- */

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
 * What `search_tasks` puts into a chat response. The tool drops timestamps and
 * truncates the description to 120 chars to keep a page of results a few KB,
 * so this is a real subset of `Task` rather than the same thing.
 *
 * Kept as its own type on purpose: a component that needs `updated_at` should
 * fail to compile against a search result rather than render `undefined`.
 */
export interface CompactTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  description: string | null;
}

/** Everything a card can render from either shape. */
export type AnyTask = Task | CompactTask;

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  due_date?: string | null;
}

/**
 * Merge semantics, enforced by the backend's `strictObject`: an absent key is
 * left alone, an explicit `null` clears the column. Sending a key the backend
 * does not know is a 400, not a silently ignored field — so only ever build
 * this from actual changes.
 */
export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: string | null;
}

export interface TaskFilters {
  query?: string;
  status?: TaskStatus[];
  priority?: TaskPriority[];
  due_from?: string;
  due_to?: string;
  limit?: number;
}

export interface TaskListResponse {
  tasks: Task[];
  /** More rows matched than `limit`. The only pagination signal that exists. */
  truncated: boolean;
}

export interface TaskResponse {
  task: Task;
}

/* --- Chats — batcave-backend/src/db/chats.ts, src/routes/chat.ts --------- */

export interface ChatRow {
  id: string;
  /** `null` until the first answered turn names it. Renders as UNTITLED. */
  title: string | null;
  /** Denormalised. Only moves when a turn is actually answered. */
  turn_count: number;
  created_at: string;
  last_message_at: string;
}

export const TOOL_NAMES = [
  'create_task',
  'search_tasks',
  'update_task',
  'schedule_reminder',
  'schedule_recurring',
  'cancel_schedule',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * One entry per tool that ran during a turn.
 *
 * Note what is *not* here: the arguments the model passed, and any timing. The
 * backend's `actionsOf` keeps only the result envelope, so a tool chip can
 * report which tool ran and how it went, but not what it was asked.
 *
 * `schedule` is the exception that proves the rule: the result echoes the time
 * it was set for, so that one detail can be shown honestly.
 */
export interface AgentAction {
  tool: ToolName | string;
  ok: boolean;
  /** create_task and update_task return the full record. */
  task?: Task;
  /** search_tasks returns the compact shape. */
  tasks?: CompactTask[];
  /** The scheduling tools. The task is nested in it, not beside it. */
  schedule?: ScheduleAction;
  error?: unknown;
}

/**
 * One exchange. The backend deliberately gives replayed history and a live
 * answer the same shape, so both render through one component path.
 */
export interface ChatTurn {
  message: string;
  reply: string | null;
  actions: AgentAction[];
}

/** POST /api/chats and POST /api/chats/:id/messages. */
export interface ChatTurnResponse {
  chat: ChatRow;
  reply: string | null;
  actions: AgentAction[];
}

/** POST /api/chats with no message: a conversation and nothing else. */
export interface ChatCreatedResponse {
  chat: ChatRow;
  reply?: undefined;
  actions?: undefined;
}

export interface ChatHistoryResponse {
  chat: ChatRow;
  turns: ChatTurn[];
}

export interface ChatListResponse {
  chats: ChatRow[];
  truncated: boolean;
}

export interface ChatResponse {
  chat: ChatRow;
}

/* --- Schedules — batcave-backend/src/types/schedule.ts ------------------- */

export const SCHEDULE_KINDS = ['once', 'recurring'] as const;
export const SCHEDULE_STATUSES = ['active', 'ended', 'cancelled'] as const;
export const NOTIFICATION_OUTCOMES = ['notified', 'skipped'] as const;

export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
export type NotificationOutcome = (typeof NOTIFICATION_OUTCOMES)[number];

/**
 * When a task's notifications happen. A due date is when work is expected; a
 * schedule is when the user hears about it, and setting one never sets the
 * other. A task has at most one active schedule.
 */
export interface Schedule {
  id: string;
  task_id: string;
  kind: ScheduleKind;
  /** Five-field cron in UTC; `null` for a one-shot reminder. */
  cron: string | null;
  /** The next firing, as an ISO instant. */
  next_at: string;
  status: ScheduleStatus;
  notification_count: number;
  created_at: string;
  ended_at: string | null;
}

/**
 * One firing of a schedule. Written by the Workflow, never by a request, which
 * is why the client learns about it by polling rather than from a response.
 */
export interface Notification {
  id: string;
  schedule_id: string;
  task_id: string;
  seq: number;
  notified_at: string;
  /** `skipped` is a reminder that woke to find its task already done. */
  outcome: NotificationOutcome;
  /** 1 when this firing put a done task back to todo. SQLite has no boolean. */
  reopened: 0 | 1;
  /** Set when the user dismisses it, never by the passage of time. */
  acknowledged_at: string | null;
}

/** What the list endpoints return: the row with its task joined in. */
export type ScheduleWithTask = Schedule & { task: Task };
export type NotificationWithTask = Notification & { task: Task };

/**
 * What a scheduling tool puts into a chat response. The task is the compact
 * shape here, and it is nested rather than top-level on purpose: scheduling
 * does not change the task, so it must not be logged as a mutation.
 */
export type ScheduleAction = Schedule & { task: CompactTask };

export interface ScheduleListResponse {
  schedules: ScheduleWithTask[];
  truncated: boolean;
}

export interface NotificationListResponse {
  notifications: NotificationWithTask[];
  truncated: boolean;
}

export interface ScheduleResponse {
  schedule: Schedule;
}

export interface NotificationResponse {
  notification: Notification;
}

/* --- Errors — batcave-backend/src/errors.ts ------------------------------ */

/** A Zod issue as the backend forwards it. `path` is empty for object-level. */
export interface ApiIssue {
  code: string;
  path: (string | number)[];
  message: string;
  keys?: string[];
}

export interface ApiErrorBody {
  error: string;
  issues?: ApiIssue[];
}
