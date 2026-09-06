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
        'Create a new task, for anything the user asks to be added to their list. Returns the task, including the id that update_task and the scheduling tools need — a task you just created can be updated or scheduled straight away, with no search first. A due date is only when the work is expected; it notifies nobody, so use schedule_reminder as well if the user asked to be reminded.',
      schema: createTaskSchema,
    },
  );
