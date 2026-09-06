import { tool } from 'langchain';
import { updateTaskToolSchema } from '../../schemas/task';
import type { TaskService } from '../../services/taskService';
import { envelope } from './envelope';
import { UPDATE_TASK } from './names';

export const updateTaskTool = (service: TaskService) =>
  tool(
    async (input) =>
      envelope(async () => {
        const { id, ...changes } = input;
        const changed = Object.keys(changes).filter(
          (key) => changes[key as keyof typeof changes] !== undefined,
        );
        return { task: await service.update(id, changes), changed };
      }),
    {
      name: UPDATE_TASK,
      description:
        'Change an existing task: rename it, re-prioritise it, move its due date, or mark it done. Send every field that changes in one call and omit the rest — omitting a field leaves it alone, and passing null to `description` or `due_date` clears it. Returns the updated task and a `changed` list of the fields that actually moved. This never touches the task\'s schedule; use cancel_schedule for that.',
      schema: updateTaskToolSchema,
    },
  );
