import { ToolMessage, createMiddleware } from 'langchain';
import { ERRORS } from '../../errors';
import { taskIdsIn } from '../format';
import { TASK_ID_TOOLS } from '../tools/names';

/**
 * A well-formed UUID is not enough: a model can invent a plausible one or reuse
 * an id from a stale part of the conversation. Every tool that takes a task id
 * it did not produce therefore only accepts ids that appeared in a search or
 * create result in this thread — writing to the wrong row and scheduling
 * against the wrong row are the same mistake.
 *
 * `request.state.messages` is the checkpointed history, so "show my Cloudflare
 * tasks" followed by "mark the first one done" resolves across turns with no
 * client-held state. The worst case for a confused model is a wasted round, not
 * a write to the wrong row.
 */
export const taskIdGuard = createMiddleware({
  name: 'taskIdGuard',
  wrapToolCall: async (request, handler) => {
    if (!TASK_ID_TOOLS.has(request.toolCall.name)) return handler(request);

    const id = (request.toolCall.args as { id?: unknown }).id;
    if (typeof id !== 'string' || !taskIdsIn(request.state.messages).has(id)) {
      return new ToolMessage({
        tool_call_id: request.toolCall.id ?? '',
        name: request.toolCall.name,
        content: JSON.stringify({ ok: false, error: ERRORS.AGENT_TASK_ID_NOT_SEEN }),
        status: 'error',
      });
    }

    return handler(request);
  },
});
