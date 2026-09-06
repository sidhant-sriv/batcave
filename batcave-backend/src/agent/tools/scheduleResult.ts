import type { TaskService } from '../../services/taskService';
import { TaskNotFoundError } from '../../services/taskService';
import type { Schedule } from '../../types/schedule';
import { compactTask } from './searchTasks';

/**
 * What every scheduling tool returns.
 *
 * The task is nested inside `schedule` rather than sitting beside it, and that
 * placement is load-bearing: a client reads a top-level `task` on an action as
 * "the agent wrote this record" and flags the row as changed. Scheduling does
 * not change the task, so the task travels as context for rendering the
 * schedule, not as a mutation.
 */
export async function scheduleResult(
  tasks: TaskService,
  taskId: string,
  result: { schedule: Schedule; replaced: Schedule | null },
): Promise<Record<string, unknown>> {
  const task = await tasks.getById(taskId);
  if (!task) throw new TaskNotFoundError(taskId);

  return {
    schedule: { ...result.schedule, task: compactTask(task) },
    replaced: result.replaced,
  };
}
