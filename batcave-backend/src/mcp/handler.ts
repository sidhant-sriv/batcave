import { createMcpHandler } from 'agents/mcp/server';
import { ERRORS } from '../errors';
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
 * The login on those props is what every tool and resource is scoped to, so an
 * MCP client sees exactly the tasks its GitHub account owns and nothing else.
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
    const props = ((ctx as ExecutionContext & { props?: unknown }).props ?? {}) as Partial<
      GrantProps
    >;

    // The only way to reach this handler is with a token the provider already
    // validated, and every grant this server issues carries a login. A missing
    // one is therefore a bug in `completeAuthorization`, not a caller error, so
    // it throws rather than falling back to something that would silently read
    // the wrong person's tasks.
    const { login } = props;
    if (!login) throw new Error(ERRORS.MCP_MISSING_IDENTITY);

    const handler = createMcpHandler(
      () =>
        buildMcpServer({
          tasks: new TaskService(env.DB, login),
          schedules: new ScheduleService(env.DB, env.TASK_SCHEDULE, login),
        }),
      {
        route: '/mcp',
        authContext: { props: props as Record<string, unknown> },
      },
    );

    return handler(request, env, ctx);
  },
};
