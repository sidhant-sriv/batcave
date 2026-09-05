import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { GraphRecursionError } from '@langchain/langgraph';
import { Hono, type Context } from 'hono';
import { buildAgent, threadConfig, type AgentOptions } from '../agent/agent';
import { actionsOf, replyOf, turnAfter, type AgentAction, type ChatTurn } from '../agent/format';
import { CHECKPOINTS_KEPT, claim, complete, fail, runKey } from '../agent/runs';
import { pruneThread } from '../db/agentState';
import type { ChatRow } from '../db/chats';
import { ERRORS } from '../errors';
import { createChatSchema, sendMessageSchema } from '../schemas/chat';
import { ChatService } from '../services/chatService';
import type { Env } from '../types/task';

/** What a turn produced, plus the chat as it stands after it. */
export interface ChatResponse {
  chat: ChatRow;
  reply: string | null;
  actions: AgentAction[];
}

export interface ChatHistoryResponse {
  chat: ChatRow;
  turns: ChatTurn[];
}

type ChatContext = Context<{ Bindings: Env }>;

/**
 * `allowEmpty` is for POST /api/chats, where sending no body at all means "an
 * empty conversation". A body that is present but not JSON is still an error.
 */
async function readJson(
  c: ChatContext,
  allowEmpty = false,
): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const raw = await c.req.text();
  if (!raw.trim()) return allowEmpty ? { ok: true, body: {} } : { ok: false };

  try {
    return { ok: true, body: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * One turn on a chat's active thread. Everything here is keyed on the thread,
 * because that is what the checkpointer and the run claim partition by; the
 * chat id only reappears in the answer.
 */
async function runTurn(params: {
  c: ChatContext;
  chats: ChatService;
  chatId: string;
  threadId: string;
  message: string;
  options: AgentOptions;
  status: 200 | 201;
}): Promise<Response> {
  const { c, chats, chatId, threadId, message, options, status } = params;

  const agent = buildAgent(c.env, options);
  const config = threadConfig(threadId);

  const state = await agent.graph.getState(config);
  const startCheckpointId: string | null = state.config?.configurable?.checkpoint_id ?? null;

  const claimed = await claim(c.env.DB, {
    key: await runKey({
      header: c.req.header('Idempotency-Key'),
      threadId,
      message,
      checkpointId: startCheckpointId,
    }),
    threadId,
    message,
    startCheckpointId,
  });

  if (claimed.kind === 'replay') return c.json(claimed.response as ChatResponse, status);
  if (claimed.kind === 'busy') return c.json({ error: ERRORS.THREAD_BUSY }, 409);

  const { key } = claimed;

  /**
   * Answering a turn is what moves the chat: recency, the count, and the name
   * if it had none. Only reached once per turn, because a replay returns above
   * and a takeover finishes the turn its first attempt never settled.
   */
  const settle = async (turn: BaseMessage[], reply?: string): Promise<Response> => {
    const chat = await chats.touch(chatId, message);
    const answer: ChatResponse = {
      chat,
      reply: reply ?? replyOf(turn),
      actions: actionsOf(turn),
    };

    await complete(c.env.DB, key, answer);
    await pruneThread(c.env.DB, threadId, CHECKPOINTS_KEPT);
    return c.json(answer, status);
  };

  try {
    if (claimed.kind === 'takeover') {
      // A worker died somewhere inside this same turn. The user's message is
      // already in the checkpoint under this run's key, so the turn is
      // finished off or read back, never started again: re-invoking would
      // answer the same message a second time.
      if (state.next.length > 0) {
        const resumed = await agent.invoke(null, config);
        return await settle(turnAfter(resumed.messages, key));
      }
      if (startCheckpointId !== claimed.row.start_checkpoint_id) {
        // The thread moved on from where this run started, so the graph did
        // run to completion and only the row is stale. Rebuild from state.
        return await settle(turnAfter(state.values.messages, key));
      }
      // Checkpoint unchanged: the run died before writing anything, so there
      // is nothing to salvage and the turn runs normally below.
    }

    // An earlier turn on this thread was interrupted. Finish it before adding
    // a new message: left alone, the checkpoint holds an assistant message
    // with tool_calls and no results, which Groq rejects with a 400.
    if (state.next.length > 0) {
      await agent.invoke(null, config);
    }

    // The stable id matters: a message without one is given a fresh uuid and
    // appended on every invoke, so a takeover would duplicate the user's turn.
    // With it, a re-invoke replaces the message in place.
    const result = await agent.invoke(
      { messages: [new HumanMessage({ id: key, content: message })] },
      config,
    );

    return await settle(turnAfter(result.messages, key));
  } catch (error) {
    // Hitting the round limit is an answer, just not a good one. The tool
    // results are in the checkpoint, so the client still learns what ran.
    if (error instanceof GraphRecursionError) {
      const exhausted = await agent.graph.getState(config);
      return await settle(turnAfter(exhausted.values.messages, key), ERRORS.AGENT_TOO_MANY_STEPS);
    }

    // Marked failed, not completed, so nothing caches a failure as a successful
    // turn and the next request on this chat can take the run over.
    await fail(c.env.DB, key, error);
    throw error;
  }
}

/**
 * A factory rather than a module-level route so tests can supply a scripted
 * model. Production uses the default, which is Groq.
 */
export function createChatRoute(options: AgentOptions = {}) {
  const chatsRoute = new Hono<{ Bindings: Env }>();

  /** Starts a conversation, and runs its first turn when one was sent. */
  chatsRoute.post('/', async (c) => {
    const body = await readJson(c, true);
    if (!body.ok) return c.json({ error: ERRORS.INVALID_JSON_BODY }, 400);

    const parsed = createChatSchema.safeParse(body.body);
    if (!parsed.success) {
      return c.json({ error: ERRORS.INVALID_CHAT_INPUT, issues: parsed.error.issues }, 400);
    }

    const { message } = parsed.data;
    if (message && !c.env.GROQ_API_KEY) {
      return c.json({ error: ERRORS.GROQ_API_KEY_MISSING }, 500);
    }

    const chats = new ChatService(c.env.DB);
    const { chat, threadId } = await chats.create();

    if (!message) return c.json({ chat }, 201);

    return runTurn({ c, chats, chatId: chat.id, threadId, message, options, status: 201 });
  });

  /** Runs a turn on an existing conversation. */
  chatsRoute.post('/:chat_id/messages', async (c) => {
    const body = await readJson(c);
    if (!body.ok) return c.json({ error: ERRORS.INVALID_JSON_BODY }, 400);

    const parsed = sendMessageSchema.safeParse(body.body);
    if (!parsed.success) {
      return c.json({ error: ERRORS.INVALID_CHAT_INPUT, issues: parsed.error.issues }, 400);
    }

    if (!c.env.GROQ_API_KEY) {
      return c.json({ error: ERRORS.GROQ_API_KEY_MISSING }, 500);
    }

    // An unknown or malformed chat id surfaces through onError as 404 or 400.
    const chats = new ChatService(c.env.DB);
    const chatId = c.req.param('chat_id');
    const threadId = await chats.activeThread(chatId);

    return runTurn({
      c,
      chats,
      chatId,
      threadId,
      message: parsed.data.message,
      options,
      status: 200,
    });
  });

  /**
   * The conversation so far. Reads the checkpoint directly, so it claims no
   * run, never calls the model, and works on a chat whose last turn failed.
   */
  chatsRoute.get('/:chat_id', async (c) => {
    const chats = new ChatService(c.env.DB);
    const chatId = c.req.param('chat_id');

    const chat = await chats.get(chatId);
    const turns = await chats.history(chatId);

    return c.json({ chat, turns } satisfies ChatHistoryResponse);
  });

  return chatsRoute;
}

export const chatsRoute = createChatRoute();
