import { createAgent, dynamicSystemPromptMiddleware } from 'langchain';
import { TaskService } from '../services/taskService';
import type { Env } from '../types/task';
import { D1Saver } from './checkpointer';
import { escalate } from './middleware/escalate';
import { sequentialToolCalls } from './middleware/sequentialToolCalls';
import { taskIdGuard } from './middleware/taskIdGuard';
import { makeModel } from './model';
import { systemPrompt, todayUtc } from './prompt';
import { buildTools } from './tools';

/**
 * A tool round is two super-steps, model then tools, and the turn ends with one
 * more model call. The recursion limit is the primitive the runtime already
 * enforces, so no extra state is needed to bound the loop.
 */
export const MAX_TOOL_ROUNDS = 5;
export const RECURSION_LIMIT = 2 * MAX_TOOL_ROUNDS + 1;

export interface AgentOptions {
  model?: Parameters<typeof createAgent>[0]['model'];
  fetch?: typeof fetch;
}

/**
 * Built per request. Tools close over a `TaskService` bound to this request's
 * D1 binding, and nothing is module-level state that could leak between
 * requests sharing an isolate.
 *
 * Middleware order is outermost first. `escalate` is last so it sits closest to
 * the tool and classifies what the tool itself raised.
 */
export function buildAgent(env: Env, options: AgentOptions = {}) {
  const service = new TaskService(env.DB);

  return createAgent({
    model: options.model ?? makeModel(env, options.fetch),
    tools: buildTools(service),
    checkpointer: new D1Saver(env.DB),
    middleware: [
      dynamicSystemPromptMiddleware(() => systemPrompt(todayUtc())),
      sequentialToolCalls,
      taskIdGuard,
      escalate,
    ],
  });
}

/** The one config every call on a thread shares: which thread, and the bound. */
export const threadConfig = (threadId: string) => ({
  configurable: { thread_id: threadId },
  recursionLimit: RECURSION_LIMIT,
});
