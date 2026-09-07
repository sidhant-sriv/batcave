import { createMiddleware } from 'hono/factory';
import { ERRORS } from '../errors';
import type { Env, SessionUser } from '../types/task';

/**
 * The door on the REST API.
 *
 * WHY THIS EXISTS RATHER THAN `apiRoute: ['/mcp', '/api']`. Letting the OAuth
 * provider guard `/api` too would have been one line, and wrong twice over. It
 * answers `OPTIONS` on anything it guards itself, with `Access-Control-Allow-
 * Origin` echoing whatever origin asked — which would quietly replace the
 * allowlist in `createApp`. And its 401 body is RFC 9728 discovery, which is
 * exactly right for an MCP client and unparseable by the frontend's `ApiError`.
 * Validating here keeps both, and still uses the library's own crypto:
 * `unwrapToken` is the same code path the MCP endpoint is checked with.
 *
 * A token minted for an MCP client is accepted here, and one minted for the web
 * app is accepted at `/mcp`. That is intended rather than overlooked — same
 * person, same single `tasks` scope, same rows — and it is why no audience check
 * appears below.
 */

/** Where the challenge points a client that arrives without a token. */
const CHALLENGE = 'Bearer realm="batcave", scope="tasks"';

export const requireUser = createMiddleware<{
  Bindings: Env;
  Variables: { user: SessionUser };
}>(async (c, next) => {
  const header = c.req.header('authorization');
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];

  const unauthorized = (message: string) =>
    c.json({ error: message }, 401, { 'WWW-Authenticate': CHALLENGE });

  if (!token) return unauthorized(ERRORS.UNAUTHORIZED);

  // Null covers every way a token can fail to be one: wrong shape, revoked,
  // expired, or minted by a different deployment's KV. None of them is worth
  // distinguishing to the caller, and all of them mean the same thing to it.
  const grant = await c.env.OAUTH_PROVIDER.unwrapToken<{
    login?: string;
    name?: string | null;
  }>(token);
  if (!grant) return unauthorized(ERRORS.AUTH_TOKEN_INVALID);

  const login = grant.grant.props?.login ?? grant.userId;
  if (!login) return unauthorized(ERRORS.AUTH_TOKEN_INVALID);

  c.set('user', { login, name: grant.grant.props?.name ?? null });
  await next();
});
