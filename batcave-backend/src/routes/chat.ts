import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { GraphRecursionError } from '@langchain/langgraph';
import { Hono } from 'hono';
import { z } from 'zod';
import { buildAgent, threadConfig, type AgentOptions } from '../agent/agent';
import { actionsOf, replyOf, turnAfter, type AgentAction, type ChatTurn } from '../agent/format';
import { threadHistory } from '../agent/history';
import { CHECKPOINTS_KEPT, claim, complete, fail, runKey } from '../agent/runs';
import { pruneThread } from '../db/agentState';
import { ERRORS } from '../errors';
import type { Env } from '../types/task';

const chatSchema = z.object({
  message: z.string().trim().min(1, ERRORS.CHAT_MESSAGE_REQUIRED).max(2000),
  /** Absent on the first turn; the response always says which thread to reuse. */
  thread_id: z.uuid().optional(),
});

export interface ChatResponse {
  thread_id: string;
  reply: string | null;
  actions: AgentAction[];
}

export interface ThreadHistoryResponse {
  thread_id: string;
  turns: ChatTurn[];
}

/**
 * A factory rather than a module-level route so tests can supply a scripted
 * model. Production uses the default, which is Groq.
 */
export function createChatRoute(options: AgentOptions = {}) {
  const chatRoute = new Hono<{ Bindings: Env }>();

  chatRoute.post('/', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: ERRORS.INVALID_JSON_BODY }, 400);
    }

    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: ERRORS.INVALID_CHAT_INPUT, issues: parsed.error.issues }, 400);
    }

    if (!c.env.GROQ_API_KEY) {
      return c.json({ error: ERRORS.GROQ_API_KEY_MISSING }, 500);
    }

    const { message } = parsed.data;
    const threadId = parsed.data.thread_id ?? crypto.randomUUID();
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

    if (claimed.kind === 'replay') return c.json(claimed.response as ChatResponse);
    if (claimed.kind === 'busy') return c.json({ error: ERRORS.THREAD_BUSY }, 409);

    const { key } = claimed;
    const respond = (turn: BaseMessage[], reply?: string): ChatResponse => ({
      thread_id: threadId,
      reply: reply ?? replyOf(turn),
      actions: actionsOf(turn),
    });

    const settle = async (answer: ChatResponse) => {
      await complete(c.env.DB, key, answer);
      await pruneThread(c.env.DB, threadId, CHECKPOINTS_KEPT);
      return c.json(answer);
    };

    try {
      if (claimed.kind === 'takeover') {
        // A worker died somewhere inside this same turn. The user's message is
        // already in the checkpoint under this run's key, so the turn is
        // finished off or read back, never started again: re-invoking would
        // answer the same message a second time.
        if (state.next.length > 0) {
          const resumed = await agent.invoke(null, config);
          return await settle(respond(turnAfter(resumed.messages, key)));
        }
        if (startCheckpointId !== claimed.row.start_checkpoint_id) {
          // The thread moved on from where this run started, so the graph did
          // run to completion and only the row is stale. Rebuild from state.
          return await settle(respond(turnAfter(state.values.messages, key)));
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

      return await settle(respond(turnAfter(result.messages, key)));
    } catch (error) {
      // Hitting the round limit is an answer, just not a good one. The tool
      // results are in the checkpoint, so the client still learns what ran.
      if (error instanceof GraphRecursionError) {
        const exhausted = await agent.graph.getState(config);
        return await settle(
          respond(turnAfter(exhausted.values.messages, key), ERRORS.AGENT_TOO_MANY_STEPS),
        );
      }

      // Marked failed, not completed, so nothing caches a failure as a successful
      // turn and the next request on this thread can take the run over.
      await fail(c.env.DB, key, error);
      throw error;
    }
  });

  /**
   * The conversation so far. Reads the checkpoint directly, so it does not
   * claim a run, does not touch the model and works on a thread whose last
   * turn failed.
   */
  chatRoute.get('/:thread_id', async (c) => {
    const threadId = c.req.param('thread_id');
    if (!z.uuid().safeParse(threadId).success) {
      return c.json({ error: ERRORS.THREAD_ID_INVALID }, 400);
    }

    const turns = await threadHistory(c.env.DB, threadId);
    if (!turns) return c.json({ error: ERRORS.THREAD_NOT_FOUND }, 404);

    return c.json({ thread_id: threadId, turns } satisfies ThreadHistoryResponse);
  });

  return chatRoute;
}

export const chatRoute = createChatRoute();
