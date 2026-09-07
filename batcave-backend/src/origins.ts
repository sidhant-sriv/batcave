import type { Env } from './types/task';

/**
 * Where the browser frontend lives.
 *
 * One list, two consumers: CORS decides which origins may call `/api/*`, and
 * `ensureWebClient` turns the same origins into the redirect URIs the frontend
 * is registered with as an OAuth client. Deriving both from `CORS_ORIGINS`
 * means adding a deployment is one var, not two things that can disagree — and
 * an origin that can complete a sign-in but not read the API, or the reverse,
 * fails in a way nobody enjoys diagnosing.
 */

/** Where the frontend runs in local development, when nothing is configured. */
export const DEV_ORIGIN = 'http://localhost:5173';

export function allowedOrigins(env: Env): string[] {
  return (env.CORS_ORIGINS ?? DEV_ORIGIN)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
