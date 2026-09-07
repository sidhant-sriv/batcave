import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { Hono, type ErrorHandler } from 'hono';
import { cors } from 'hono/cors';
import { findInfrastructureError } from './agent/middleware/escalate';
import { classifyModelError } from './agent/modelErrors';
import { ERRORS } from './errors';
import { requireUser } from './middleware/auth';
import { allowedOrigins } from './origins';
import { authRoute } from './routes/auth';
import { chatsRoute } from './routes/chat';
import { notificationsRoute } from './routes/notifications';
import { schedulesRoute } from './routes/schedules';
import { tasksRoute } from './routes/tasks';
import { mcpHandler } from './mcp/handler';
import { createOAuthRoutes, type OAuthRouteOptions } from './oauth/github';
import { transcribeRoute } from './routes/transcribe';
import { ChatBusyError, ChatNotFoundError, ChatValidationError } from './services/chatService';
import {
  NotificationNotFoundError,
  ScheduleNotFoundError,
  ScheduleValidationError,
} from './services/scheduleService';
import { TaskNotFoundError, TaskValidationError } from './services/taskService';
import type { AppEnv, Env } from './types/task';

/**
 * Everything that is not the MCP endpoint: the REST API the frontend calls, and
 * the authorize/callback pair the OAuth provider hands off to.
 *
 * A factory rather than a module-level app, for the reason `createChatRoute` is
 * one — the GitHub calls have to be swappable in a test.
 */
export function createApp(options: OAuthRouteOptions = {}) {
  const app = new Hono<AppEnv>();

  /**
   * The frontend is a separate Pages deployment, so every browser call is
   * cross-origin. Allowlisted from a var rather than `*` because `Idempotency-Key`
   * is a non-simple header: the browser preflights any turn that sends one, and a
   * wildcard would not name it. Echoing the request's own origin rather than
   * returning the whole list is what keeps the response cacheable per origin.
   */
  app.use('/api/*', cors({
    origin: (origin, c) => (allowedOrigins(c.env as Env).includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Idempotency-Key', 'Authorization'],
    maxAge: 86400,
  }));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  /**
   * ORDER MATTERS HERE, so it is asserted in `test/auth.test.ts`.
   *
   * `/api/auth/config` has to answer a browser that has no token yet, and Hono
   * runs the handlers it matched in registration order. Mounting this router
   * ahead of the blanket guard is what lets `config` reply and stop the chain
   * before `requireUser` is ever reached; `/me`, in the same router, carries its
   * own guard so it does not depend on that.
   *
   * The CORS middleware above stays ahead of both, so a preflight — which
   * carries no `Authorization` header, and never could — is answered as a
   * preflight rather than challenged as an anonymous request.
   */
  app.route('/api/auth', authRoute);

  app.use('/api/*', requireUser);

  app.route('/api/tasks', tasksRoute);
  app.route('/api/chats', chatsRoute);
  app.route('/api/schedules', schedulesRoute);
  app.route('/api/notifications', notificationsRoute);
  app.route('/api/transcribe', transcribeRoute);

  // The consent page and the GitHub round trip. Deliberately not under /api:
  // these are browser pages rather than part of the JSON API, and they are
  // reached by a redirect the OAuth library hands out, never by the frontend.
  app.route('/', createOAuthRoutes(options));

  app.notFound((c) => c.json({ error: ERRORS.NOT_FOUND }, 404));

  app.onError(onError);

  return app;
}


/**
 * Two audiences. A caller who sent something wrong gets 400 or 404 and can fix
 * it; everything else is ours to fix and is logged. The agent's failures are
 * unwrapped from whatever the graph added on the way out, so a D1 outage inside
 * a tool surfaces as 503 rather than a generic 500 or, worse, a 200.
 */
export const onError: ErrorHandler<AppEnv> = (error, c) => {
  if (error instanceof TaskValidationError) {
    return c.json({ error: error.message, issues: error.issues }, 400);
  }
  if (error instanceof TaskNotFoundError) {
    return c.json({ error: error.message }, 404);
  }
  if (error instanceof ChatValidationError) {
    return c.json({ error: error.message, issues: error.issues }, 400);
  }
  if (error instanceof ChatNotFoundError) {
    return c.json({ error: error.message }, 404);
  }
  if (error instanceof ChatBusyError) {
    return c.json({ error: error.message }, 409);
  }
  if (error instanceof ScheduleValidationError) {
    return c.json({ error: error.message, issues: error.issues }, 400);
  }
  if (error instanceof ScheduleNotFoundError || error instanceof NotificationNotFoundError) {
    return c.json({ error: error.message }, 404);
  }

  const infrastructure = findInfrastructureError(error);
  if (infrastructure) {
    console.error(`Tool "${infrastructure.tool}" failed:`, infrastructure.cause);
    return c.json({ error: ERRORS.AGENT_UNAVAILABLE }, 503);
  }

  const model = classifyModelError(error);
  if (model) {
    console.error('Model call failed:', error);
    return c.json({ error: model.message }, model.status);
  }

  console.error('Unhandled error:', error);
  return c.json({ error: ERRORS.INTERNAL_SERVER_ERROR }, 500);
};

/**
 * The Worker: an OAuth 2.1 authorization server with the MCP endpoint behind it,
 * and everything else carrying on exactly as before.
 *
 * WHAT IS PROTECTED, AND BY WHICH HALF. `apiRoute` is only `/mcp`: the library
 * validates that one itself and puts the grant on `ctx.props`. The REST API is
 * equally closed, but guarded by `requireUser` inside the Hono app instead —
 * see `middleware/auth.ts` for why, which comes down to CORS and error shape.
 * Both doors are the same lock: one authorization server, one `tasks` scope,
 * one GitHub login on the other side.
 *
 * The library owns `/oauth/token`, `/oauth/register` and the two `.well-known`
 * documents; it validates bearer tokens on `/mcp` and puts the grant on
 * `ctx.props`; everything it does not recognise goes to the Hono app with
 * `env.OAUTH_PROVIDER` injected, which is how the authorize routes reach it.
 */
export function createWorker(options: OAuthRouteOptions = {}) {
  return new OAuthProvider<Env>({
    apiRoute: '/mcp',
    apiHandler: mcpHandler,
    defaultHandler: createApp(options),

    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    // Deprecated by the 2026-07-28 spec in favour of metadata documents, but
    // kept because the clients people actually run still use it.
    clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true,

    scopesSupported: ['tasks'],
    resourceMetadata: {
      resource_name: 'Batcave',
      scopes_supported: ['tasks'],
      bearer_methods_supported: ['header'],
    },

    // `resource` is deliberately left out of resourceMetadata above: the
    // library derives it from the request, so one build serves localhost, the
    // tests and workers.dev without knowing its own public URL.

    onError: ({ code, status, internal }) => {
      // A client's mistakes are its own; the library's internal failures — a
      // metadata document it could not fetch, a KV read that failed — are ours
      // to see. Same split `onError` above draws for the API.
      if (internal) console.error(`OAuth ${code} (${status}):`, internal.category, internal.reason);
    },
  });
}

/**
 * The Workflow class has to be exported from the Worker's main module for the
 * runtime to find it; the `class_name` in wrangler.jsonc names this export.
 */
export { TaskScheduleWorkflow } from './workflows/taskSchedule';

export default createWorker();
