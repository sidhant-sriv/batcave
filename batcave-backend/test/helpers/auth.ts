import { SELF, createExecutionContext, env } from 'cloudflare:test';
import type { MiddlewareHandler } from 'hono';
import { createWorker } from '../../src/index';
import type { AppEnv, Env } from '../../src/types/task';
import { CookieJar, pkce, stubbedGithub } from './github';

/**
 * A signed-in caller, without a browser.
 *
 * Every suite that goes over HTTP needs a bearer token now, and there is no
 * honest shortcut to one: tokens are encrypted with a key wrapped by the token
 * itself, so nothing outside the library can forge a grant. The only way in is
 * the front door, which this drives — register, authorize, GitHub, exchange —
 * with GitHub stubbed. That the tests have to do this is the point: the same
 * flow a real client runs is the one every suite exercises before it starts.
 *
 * Two Workers, one KV. `SELF` runs the real one and cannot be handed a stubbed
 * fetch, so the GitHub leg goes through a Worker built here; the grant lands in
 * the shared `OAUTH_KV`, so the token `SELF` is then called with is accepted.
 * `test/oauth.test.ts` asserts that arrangement directly.
 */

/** The login every suite runs as, unless it is testing what a second one sees. */
export const OWNER = 'octocat';

/** The other one. Only isolation tests need it. */
export const OTHER_OWNER = 'hubot';

/** This test client's registered redirect URI. Never actually followed. */
const REDIRECT = 'https://client.test/callback';

/**
 * Signing in costs six round trips, and nothing in a suite invalidates a token,
 * so it is done once per login per file. `resetDb` empties D1 and leaves KV
 * alone, which is exactly what makes this safe across tests.
 */
const tokens = new Map<string, Promise<string>>();

export function signIn(login: string = OWNER): Promise<string> {
  const cached = tokens.get(login);
  if (cached) return cached;

  const pending = mint(login);
  tokens.set(login, pending);
  return pending;
}

/**
 * Stands in for `requireUser` on a hand-built app.
 *
 * The suites that mount `createChatRoute` directly are asking what the route
 * does once someone is through the door, and they run on an `env` the OAuth
 * provider never injected itself into, so there is no `unwrapToken` to call.
 * Supplying the session is the same move `test/helpers/mcp.ts` makes with
 * `ctx.props`: what the door does is `test/auth.test.ts`'s subject instead.
 */
export const asUser =
  (login: string = OWNER): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    c.set('user', { login, name: login });
    await next();
  };

/** `SELF.fetch` with the Authorization header already on it. */
export async function api(
  path: string,
  init: RequestInit = {},
  login: string = OWNER,
): Promise<Response> {
  const token = await signIn(login);
  return SELF.fetch(`https://test${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token}` },
  });
}

async function mint(login: string): Promise<string> {
  const github = stubbedGithub({ login, name: login });
  const worker = createWorker({ fetch: github.fetch });
  const jar = new CookieJar();

  const call = (path: string, init: RequestInit = {}) =>
    worker.fetch(
      new Request(`https://test${path}`, init),
      // Spread, because the library assigns OAUTH_PROVIDER onto the env it is
      // given and `cloudflare:test`'s env is frozen.
      { ...env } as Env,
      createExecutionContext(),
    );

  const registered = await call('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: `Test client for ${login}`,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    }),
  });
  const { client_id: clientId } = (await registered.json()) as { client_id: string };

  const { verifier, challenge } = await pkce();
  const query =
    `response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}` +
    `&scope=tasks&state=test&code_challenge=${challenge}&code_challenge_method=S256`;

  // A third-party client, so this one does see the consent page.
  const consent = await call(`/authorize?${query}`);
  jar.absorb(consent);
  const nonce = /name="nonce" value="([^"]+)"/.exec(await consent.text())?.[1];

  const approved = await call(`/authorize?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header },
    body: new URLSearchParams({ nonce: nonce!, decision: 'approve' }).toString(),
  });
  jar.absorb(approved);

  const state = new URL(approved.headers.get('location')!).searchParams.get('state')!;
  const callback = await call(`/callback?code=gh-code&state=${state}`, {
    headers: { cookie: jar.header },
  });
  const code = new URL(callback.headers.get('location')!).searchParams.get('code')!;

  const token = await call('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    }).toString(),
  });

  const { access_token: accessToken } = (await token.json()) as { access_token?: string };
  if (!accessToken) throw new Error(`Could not sign in as ${login}`);
  return accessToken;
}
