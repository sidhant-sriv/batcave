import { createMcpHandler } from 'agents/mcp/server';
import { ScheduleService } from '../services/scheduleService';
import { TaskService } from '../services/taskService';
import type { Env } from '../types/task';
import { buildMcpServer } from './server';

/**
 * The MCP endpoint, as the OAuth provider's protected handler.
 *
 * By the time this runs the bearer token has already been validated and the
 * grant's props are on `ctx.props`. That is the whole reason the handler never
 * reads an `Authorization` header: token verification belongs in front of it,
 * and a protected handler that also parses credentials has two answers to the
 * same question.
 *
 * Everything is built per request — services, server, handler — for the reason
 * the rest of this codebase builds per request: nothing about one caller may
 * survive in an isolate that the next caller reuses. The protocol allows it,
 * because the 2026-07-28 revision is stateless: every request carries its own
 * protocol version and capabilities, so there is no session to keep.
 */

export interface GrantProps {
  login: string;
  name: string | null;
}

export const mcpHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as ExecutionContext & { props?: unknown }).props;

    const handler = createMcpHandler(
      () =>
        buildMcpServer({
          tasks: new TaskService(env.DB),
          schedules: new ScheduleService(env.DB, env.TASK_SCHEDULE),
        }),
      {
        route: '/mcp',
        authContext: { props: (props ?? {}) as Record<string, unknown> },
      },
    );

    return handler(request, env, ctx);
  },
};
