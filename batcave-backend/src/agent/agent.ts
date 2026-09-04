import type { TaskService } from '../services/taskService';
import type { Task } from '../types/task';
import { CREATE_TASK_TOOL_NAME, createTaskTool, runCreateTaskTool } from './tools/createTask';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

/** Thrown when Groq itself is unreachable or returns an error response. */
export class GroqError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GroqError';
  }
}

interface GroqToolCall {
  id: string;
  function: { name: string; arguments: string };
}

interface GroqResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: GroqToolCall[] };
  }>;
}

export interface AgentResult {
  task: Task | null;
  message: string | null;
}

function systemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    'You are a task management assistant.',
    `Today is ${today} (UTC).`, // this could be moved to a human message to facilitate prompt caching
    `When the user asks for a task to be created, call the ${CREATE_TASK_TOOL_NAME} tool.`,
    'Resolve relative dates like "Friday" or "tomorrow" into absolute YYYY-MM-DD dates.',
    'If the request is not about creating a task, reply in plain text instead of calling a tool.',
  ].join(' ');
}

/**
 * Send a user message to Groq with the create_task tool available. Any tool
 * call it makes is validated and executed through TaskService.
 */
export async function runAgent(
  message: string,
  taskService: TaskService,
  env: { GROQ_API_KEY: string; GROQ_MODEL?: string },
): Promise<AgentResult> {
  let response: Response;
  try {
    response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.GROQ_MODEL ?? DEFAULT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: message },
        ],
        tools: [createTaskTool],
        tool_choice: 'auto',
      }),
    });
  } catch (error) {
    throw new GroqError(`Could not reach Groq: ${(error as Error).message}`, 502);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new GroqError(`Groq returned ${response.status}: ${body.slice(0, 500)}`, 502);
  }

  const data = (await response.json()) as GroqResponse;
  const assistant = data.choices?.[0]?.message;
  const toolCall = assistant?.tool_calls?.find(
    (call) => call.function.name === CREATE_TASK_TOOL_NAME,
  );

  if (!toolCall) {
    return { task: null, message: assistant?.content ?? null };
  }

  const task = await runCreateTaskTool(toolCall.function.arguments, taskService);
  return { task, message: assistant?.content ?? null };
}
