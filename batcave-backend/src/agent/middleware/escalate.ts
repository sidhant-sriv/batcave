import { MiddlewareError, ToolInvocationError, createMiddleware } from 'langchain';
import { ERROR_TEMPLATES } from '../../errors';

/** A tool failure nothing in the conversation can fix. Mapped to 503. */
export class InfrastructureError extends Error {
  constructor(
    readonly tool: string,
    options?: { cause?: unknown },
  ) {
    super(ERROR_TEMPLATES.toolInfrastructureFailure(tool), options);
    this.name = 'InfrastructureError';
  }
}

const MAX_CAUSE_DEPTH = 10;

/**
 * An explicit allowlist, never a pattern match on messages: only LangChain's
 * marker for tool-input schema failures, which is exactly the case the model
 * can fix by calling again with better arguments. It arrives unwrapped from the
 * tool node, but survives a MiddlewareError wrapper if this ever stops being
 * the innermost middleware.
 */
function isModelCorrectable(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (ToolInvocationError.isInstance(current)) return true;
    if (!MiddlewareError.isInstance(current)) return false;
    current = current.cause;
  }
  return false;
}

/** Finds an InfrastructureError under whatever wrappers it collected. */
export function findInfrastructureError(error: unknown): InfrastructureError | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (current instanceof InfrastructureError) return current;
    if (!(current instanceof Error)) return null;
    current = current.cause;
  }
  return null;
}

/**
 * Left to itself, LangChain turns any thrown tool error into a ToolMessage
 * saying "Error: ...\n Please fix your mistakes." The model then apologises to
 * the user and the route returns 200, so a D1 outage looks like a successful
 * turn, monitoring sees nothing, and the run row caches the apology as the
 * answer — every retry with the same key replays the failure instead of
 * retrying it.
 *
 * So infrastructure errors are rethrown out of the graph instead. The
 * checkpoint is left with the tools step still pending, which is the same
 * resumable state an interrupted turn leaves behind, so the next request on the
 * thread retries the tool call.
 *
 * Innermost of the tool middlewares: it classifies what the tool itself raised.
 */
export const escalate = createMiddleware({
  name: 'escalate',
  wrapToolCall: async (request, handler) => {
    try {
      return await handler(request);
    } catch (error) {
      if (isModelCorrectable(error)) throw error;
      throw new InfrastructureError(request.toolCall.name, { cause: error });
    }
  },
});
