import { tool } from 'langchain';
import { searchTasksToolSchema } from '../../schemas/task';
import type { TaskService } from '../../services/taskService';
import type { Task } from '../../types/task';
import { envelope } from './envelope';
import { SEARCH_TASKS } from './names';

/** Enough for the model to tell two tasks apart without spending the context. */
const DESCRIPTION_PREVIEW = 120;

/**
 * What the model reads, and the only place it can get an id it is later allowed
 * to update. Timestamps are dropped and descriptions truncated so a full page
 * of results stays a few KB.
 */
export const compactTask = (task: Task) => ({
  id: task.id,
  title: task.title,
  status: task.status,
  priority: task.priority,
  due_date: task.due_date,
  description: task.description?.slice(0, DESCRIPTION_PREVIEW) ?? null,
});

export const searchTasksTool = (service: TaskService) =>
  tool(
    async (input) =>
      envelope(async () => {
        const { tasks, truncated } = await service.search(input);
        return { count: tasks.length, truncated, tasks: tasks.map(compactTask) };
      }),
    {
      name: SEARCH_TASKS,
      description:
        'Find tasks. Every filter is optional and they narrow the result together. Pass one or two distinctive keywords as `query`, not a whole sentence. Use due_from/due_to as inclusive YYYY-MM-DD bounds; both exclude tasks with no due date. Call this before updating anything, to get the task id.',
      schema: searchTasksToolSchema,
    },
  );
