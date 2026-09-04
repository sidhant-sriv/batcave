import { createTaskSchema } from '../../schemas/task';
import { TaskValidationError, type TaskService } from '../../services/taskService';
import { TASK_PRIORITIES } from '../../types/task';
import type { Task } from '../../types/task';

export const CREATE_TASK_TOOL_NAME = 'create_task';

/**
 * Tool exposed to Groq. The JSON schema is only a hint for the model — the
 * arguments it returns are always re-validated with Zod before we trust them.
 */
export const createTaskTool = {
  type: 'function',
  function: {
    name: CREATE_TASK_TOOL_NAME,
    description:
      'Create a new task. Call this whenever the user asks for something to be added to their task list.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short imperative summary of the task.',
        },
        description: {
          type: 'string',
          description: 'Optional longer detail. Omit if the user gave none.',
        },
        priority: {
          type: 'string',
          enum: [...TASK_PRIORITIES],
          description: 'Task priority. Defaults to medium if the user did not say.',
        },
        due_date: {
          type: 'string',
          description:
            'Optional due date as YYYY-MM-DD. Resolve relative dates such as "Friday" against today.',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
} as const;

/**
 * Validate raw tool arguments from the LLM and persist through TaskService.
 * The model never touches D1 — it only proposes arguments.
 */
export async function runCreateTaskTool(
  rawArguments: string,
  taskService: TaskService,
): Promise<Task> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawArguments);
  } catch {
    throw new TaskValidationError('Model returned malformed tool arguments', [
      { message: 'tool arguments were not valid JSON' },
    ]);
  }

  const parsed = createTaskSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new TaskValidationError('Model returned invalid task arguments', parsed.error.issues);
  }

  return taskService.create(parsed.data);
}
