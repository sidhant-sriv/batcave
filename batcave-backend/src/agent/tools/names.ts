/** Tool names, in their own module so the prompt and middleware can import
 *  them without pulling in the services and the whole tool implementations. */
export const CREATE_TASK = 'create_task';
export const SEARCH_TASKS = 'search_tasks';
export const UPDATE_TASK = 'update_task';
export const SCHEDULE_REMINDER = 'schedule_reminder';
export const SCHEDULE_RECURRING = 'schedule_recurring';
export const CANCEL_SCHEDULE = 'cancel_schedule';

/**
 * Every tool that takes a task id it did not produce. `taskIdGuard` refuses
 * these unless the id appeared in a search or create result on the thread.
 */
export const TASK_ID_TOOLS = new Set<string>([
  UPDATE_TASK,
  SCHEDULE_REMINDER,
  SCHEDULE_RECURRING,
  CANCEL_SCHEDULE,
]);

export type ToolName =
  | typeof CREATE_TASK
  | typeof SEARCH_TASKS
  | typeof UPDATE_TASK
  | typeof SCHEDULE_REMINDER
  | typeof SCHEDULE_RECURRING
  | typeof CANCEL_SCHEDULE;
