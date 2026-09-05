import { ToolMessage, createMiddleware } from 'langchain';
import { ERRORS } from '../../errors';
import { taskIdsIn } from '../format';
import { UPDATE_TASK } from '../tools/names';

/**
 * A well-formed UUID is not enough: a model can invent a plausible one or reuse
 * an id from a stale part of the conversation. `update_task` therefore only
 * accepts ids that appeared in a search or create result in this thread.
 *
 * `request.state.messages` is the checkpointed history, so "show my Cloudflare
 * tasks" followed by "mark the first one done" resolves across turns with no
 * client-held state. The worst case for a confused model is a wasted round, not
 * a write to the wrong row.
 */
export const taskIdGuard = createMiddleware({
  name: 'taskIdGuard',
  wrapToolCall: async (request, handler) => {
    if (request.toolCall.name !== UPDATE_TASK) return handler(request);

    const id = (request.toolCall.args as { id?: unknown }).id;
    if (typeof id !== 'string' || !taskIdsIn(request.state.messages).has(id)) {
      return new ToolMessage({
        tool_call_id: request.toolCall.id ?? '',
        name: UPDATE_TASK,
        content: JSON.stringify({ ok: false, error: ERRORS.AGENT_TASK_ID_NOT_SEEN }),
        status: 'error',
      });
    }

    return handler(request);
  },
});
