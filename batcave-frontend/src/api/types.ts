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

export const TOOL_NAMES = ['create_task', 'search_tasks', 'update_task'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * One entry per tool that ran during a turn.
 *
 * Note what is *not* here: the arguments the model passed, and any timing. The
 * backend's `actionsOf` keeps only the result envelope, so a tool chip can
 * report which tool ran and how it went, but not what it was asked.
 */
export interface AgentAction {
  tool: ToolName | string;
  ok: boolean;
  /** create_task and update_task return the full record. */
  task?: Task;
  /** search_tasks returns the compact shape. */
  tasks?: CompactTask[];
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
