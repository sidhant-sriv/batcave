/** Tool names, in their own module so the prompt and middleware can import
 *  them without pulling in TaskService and the whole tool implementations. */
export const CREATE_TASK = 'create_task';
export const SEARCH_TASKS = 'search_tasks';
export const UPDATE_TASK = 'update_task';

export type ToolName = typeof CREATE_TASK | typeof SEARCH_TASKS | typeof UPDATE_TASK;
