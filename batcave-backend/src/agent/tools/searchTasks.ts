import { tool } from 'langchain';
import { searchTasksToolSchema } from '../../schemas/task';
import type { TaskService } from '../../services/taskService';
import type { Task, TaskWithSchedule } from '../../types/task';
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

/**
 * A search result: the compact task plus its active schedule, or null when
 * nothing notifies about it. The schedule travels with the task because the
 * model cannot otherwise answer "which of these are scheduled" — there is no
 * tool that lists schedules, and a due date is not one.
 */
const searchResult = (task: TaskWithSchedule) => ({
  ...compactTask(task),
  schedule: task.schedule,
});

export const searchTasksTool = (service: TaskService) =>
  tool(
    async (input) =>
      envelope(async () => {
        const { tasks, truncated } = await service.search(input);
        return { count: tasks.length, truncated, tasks: tasks.map(searchResult) };
      }),
    {
      name: SEARCH_TASKS,
      description:
        'Find the user\'s tasks. Every filter is optional and they narrow the result together, so start broad: passing no filter at all lists recent tasks. Returns `{ count, truncated, tasks }`, and each task carries the id that update_task and the scheduling tools need — this is the only way to obtain one, so call it before changing or scheduling anything. Each task also carries `schedule`: null when nothing notifies about it, otherwise `{ kind, cron, next_at }` for the reminder ("once") or recurring cron it has — so this tool, with `scheduled: true`, is how you answer what the user is being reminded about, and how you check what a new schedule would replace. `truncated` means more tasks matched than were returned; narrow the filters rather than paging. An empty result is a real answer: retry once with fewer or broader keywords, then tell the user nothing matched.',
      schema: searchTasksToolSchema,
    },
  );
