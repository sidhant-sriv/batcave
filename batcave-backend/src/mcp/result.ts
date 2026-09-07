import { ERRORS } from '../errors';
import {
  NotificationNotFoundError,
  ScheduleNotFoundError,
  ScheduleValidationError,
} from '../services/scheduleService';
import { TaskNotFoundError, TaskValidationError } from '../services/taskService';

/**
 * Tool results, classified the way `src/agent/tools/envelope.ts` classifies
 * them — the split is about who can act on a failure, not about which protocol
 * asked — but with a different second half, because MCP forces one.
 *
 * A tool handler CANNOT signal "this call did not happen" by throwing. The SDK
 * catches anything a handler throws and turns it into the same `isError: true`
 * result, using the exception's message as the text. So a rethrow here would
 * not produce a protocol error; it would hand the client `D1_UNAVAILABLE` and
 * tell it the tool ran and refused. Two things follow:
 *
 * - Failures the caller caused and can correct — bad arguments, an id that is
 *   not in the table, a cron that never fires, a reminder in the past — are
 *   returned with the service's own message, which is written for a reader.
 * - Everything else is ours. It is logged with its cause, and the caller is
 *   told only that the tool could not run. An internal message is not a thing
 *   to put on the wire: it cannot help whoever is holding the other end, and
 *   it describes our infrastructure to a stranger.
 *
 * Resource reads are the other half of this and live in `server.ts`: there a
 * throw IS the right move, because the SDK maps `ResourceNotFoundError` onto
 * the JSON-RPC error the protocol defines for a URI that is not there.
 *
 * The payload is a JSON string rather than `structuredContent`, matching the
 * agent's tools. `structuredContent` needs a declared `outputSchema` to be
 * meaningful, and none of these results have a shape stable enough to promise
 * one — `search_tasks` alone returns three different envelopes.
 */

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  /** The SDK's result type is open: a tool may attach `_meta` and the rest. */
  [key: string]: unknown;
}

const text = (payload: Record<string, unknown>): McpToolResult['content'] => [
  { type: 'text', text: JSON.stringify(payload) },
];

const ok = (payload: Record<string, unknown>): McpToolResult => ({
  content: text({ ok: true, ...payload }),
});

const refused = (error: string, issues?: unknown): McpToolResult => ({
  content: text({ ok: false, error, ...(issues === undefined ? {} : { issues }) }),
  isError: true,
});

export async function toolResult(
  tool: string,
  run: () => Promise<Record<string, unknown>>,
): Promise<McpToolResult> {
  try {
    return ok(await run());
  } catch (error) {
    if (error instanceof TaskValidationError) return refused(error.message, error.issues);
    if (error instanceof TaskNotFoundError) return refused(error.message);
    if (error instanceof ScheduleValidationError) return refused(error.message, error.issues);
    if (error instanceof ScheduleNotFoundError) return refused(error.message);
    if (error instanceof NotificationNotFoundError) return refused(error.message);

    console.error(`MCP tool "${tool}" failed:`, error);
    return refused(ERRORS.MCP_TOOL_UNAVAILABLE);
  }
}
