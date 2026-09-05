import type { TaskService } from '../../services/taskService';
import { createTaskTool } from './createTask';
import { searchTasksTool } from './searchTasks';
import { updateTaskTool } from './updateTask';

/**
 * Tools are built per request in a factory closing over the service, so nothing
 * about the agent is module-level state that could leak between requests in a
 * reused isolate.
 */
export const buildTools = (service: TaskService) => [
  createTaskTool(service),
  searchTasksTool(service),
  updateTaskTool(service),
];

export { CREATE_TASK, SEARCH_TASKS, UPDATE_TASK } from './names';
