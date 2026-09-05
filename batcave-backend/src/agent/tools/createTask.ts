import { tool, type ToolRuntime } from 'langchain';
import { createTaskSchema } from '../../schemas/task';
import type { TaskService } from '../../services/taskService';
import { taskId } from '../taskId';
import { envelope } from './envelope';
import { CREATE_TASK } from './names';

//TODO: what if we want to created multiple tasks at once?
export const createTaskTool = (service: TaskService) =>
  tool(
    async (input, runtime: ToolRuntime) =>
      envelope(async () => ({
        task: await service.create(input, { id: await taskId(runtime.toolCallId) }),
      })),
    {
      name: CREATE_TASK,
      description:
        'Create a new task. Call this whenever the user asks for something to be added to their task list. Resolve relative dates such as "Friday" into an absolute YYYY-MM-DD date first.',
      schema: createTaskSchema,
    },
  );
