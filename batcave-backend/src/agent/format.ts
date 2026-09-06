import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { CREATE_TASK, SEARCH_TASKS } from './tools/names';

/**
 * One entry per tool that ran this turn, so a UI can render created and updated
 * tasks structurally instead of parsing the prose.
 */
export interface AgentAction {
  tool: string;
  ok: boolean;
  task?: unknown;
  tasks?: unknown[];
  /** What a scheduling tool produced, with the task it belongs to nested in it. */
  schedule?: unknown;
  error?: unknown;
}

/** The user-facing text: the last assistant message that actually said something. */
export function replyOf(messages: BaseMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (AIMessage.isInstance(message) && message.text.trim().length > 0) {
      return message.text;
    }
  }
  return null;
}

/**
 * Tool results are JSON envelopes, but not all of them: LangChain's default
 * error path produces a plain sentence. A payload that will not parse is
 * reported as a failed action rather than dropped.
 */
function payloadOf(message: ToolMessage): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(message.text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function actionsOf(messages: BaseMessage[]): AgentAction[] {
  const actions: AgentAction[] = [];

  for (const message of messages) {
    if (!ToolMessage.isInstance(message)) continue;

    const tool = message.name ?? 'unknown';
    const payload = payloadOf(message);
    if (!payload) {
      actions.push({ tool, ok: false, error: message.text });
      continue;
    }

    const action: AgentAction = { tool, ok: payload.ok === true };
    if (payload.task !== undefined) action.task = payload.task;
    if (Array.isArray(payload.tasks)) action.tasks = payload.tasks;
    if (payload.schedule !== undefined) action.schedule = payload.schedule;
    if (payload.error !== undefined) action.error = payload.error;
    actions.push(action);
  }

  return actions;
}

/** Ids the model has legitimately seen: everything a search or create returned. */
export function taskIdsIn(messages: BaseMessage[]): Set<string> {
  const ids = new Set<string>();

  for (const message of messages) {
    if (!ToolMessage.isInstance(message)) continue;
    if (message.name !== SEARCH_TASKS && message.name !== CREATE_TASK) continue;

    const payload = payloadOf(message);
    if (!payload || payload.ok !== true) continue;

    const task = payload.task as { id?: unknown } | undefined;
    if (typeof task?.id === 'string') ids.add(task.id);

    if (Array.isArray(payload.tasks)) {
      for (const entry of payload.tasks as Array<{ id?: unknown }>) {
        if (typeof entry?.id === 'string') ids.add(entry.id);
      }
    }
  }

  return ids;
}

/**
 * Everything produced after this turn's user message. Located by the message's
 * id rather than by counting from a length taken earlier, so it stays right
 * when an interrupted previous turn had to be finished off first.
 */
export function turnAfter(
  messages: BaseMessage[] | undefined,
  userMessageId: string,
): BaseMessage[] {
  if (!messages) return [];
  const index = messages.findIndex((message) => message.id === userMessageId);
  return index === -1 ? [] : messages.slice(index + 1);
}

/** One exchange: what the user asked, and everything the agent did about it. */
export interface ChatTurn {
  message: string;
  reply: string | null;
  actions: AgentAction[];
}

/**
 * The thread split into turns, cut at each user message. Deliberately the same
 * shape as a POST /api/chat response minus the thread id, so a client renders
 * replayed history and a live reply through one code path.
 *
 * Anything before the first user message is dropped. In practice there is
 * nothing there: the system prompt is rebuilt per model call by
 * `dynamicSystemPromptMiddleware` and never enters state.
 */
export function turnsOf(messages: BaseMessage[] | undefined): ChatTurn[] {
  if (!messages) return [];

  const turns: ChatTurn[] = [];
  let asked: string | null = null;
  let since: BaseMessage[] = [];

  const flush = () => {
    if (asked === null) return;
    turns.push({ message: asked, reply: replyOf(since), actions: actionsOf(since) });
  };

  for (const message of messages) {
    if (HumanMessage.isInstance(message)) {
      flush();
      asked = message.text;
      since = [];
      continue;
    }
    since.push(message);
  }
  flush();

  return turns;
}
