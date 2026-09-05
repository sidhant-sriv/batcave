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
        'Change an existing task. `id` must come from a search_tasks or create_task result in this conversation; ids cannot be guessed. Send only the fields that change, and send all of them in one call. Use null to clear description or due_date.',
      schema: updateTaskToolSchema,
    },
  );
