import { Hono } from 'hono';
import { requireUser } from '../middleware/auth';
import { ensureWebClient } from '../oauth/webClient';
import type { AppEnv } from '../types/task';

/**
 * How a signed-out browser finds its way in, and how a signed-in one names
 * itself.
 *
 * `/config` is the one `/api` route that answers without a token — it has to,
 * because it is what the sign-in screen reads before there is a token to have.
 * It carries no secret: a public client's id is public by definition, and the
 * two endpoint URLs are already in `/.well-known/oauth-authorization-server`.
 * This exists so the frontend needs one environment variable instead of three.
 */
export const authRoute = new Hono<AppEnv>();

authRoute.get('/config', async (c) => {
  const origin = new URL(c.req.url).origin;

  return c.json({
    client_id: await ensureWebClient(c.env),
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    scope: 'tasks',
  });
});

/**
 * Carries its own guard rather than relying on the blanket one in `createApp`,
 * because this router is mounted ahead of it. Explicit here is worth more than
 * short: the whole file would otherwise depend on a mounting order two files
 * away.
 */
authRoute.get('/me', requireUser, (c) => c.json({ user: c.get('user') }));
