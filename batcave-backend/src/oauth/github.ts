import { Hono, type Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import { ERRORS } from '../errors';
import type { AppEnv, Env } from '../types/task';
import { renderConsentPage } from './consent';
import { ensureWebClient } from './webClient';
import {
  CONSENT_COOKIE,
  STATE_COOKIE,
  STATE_TTL_SECONDS,
  newToken,
  putState,
  takeState,
} from './state';

/**
 * The half of OAuth that is ours.
 *
 * The library is an authorization server, not an identity provider: it will
 * mint tokens for a user, but it has no idea who anyone is. These three routes
 * are the part that finds out — show a consent page, send the browser to
 * GitHub, and hand the answer back.
 *
 * The GitHub calls go through an injected `fetch` for the same reason the model
 * calls do (see `createChatRoute`): a test has to be able to run the whole flow
 * without a network or a real OAuth app.
 *
 * These routes live on the ordinary Hono app, which is the library's
 * `defaultHandler`, so they get the app's CORS decisions, its 404 and its error
 * handler for free. What they do NOT do is let an unexpected throw reach that
 * handler as a 500: every expected failure is answered here, in words the
 * person in the browser can act on, because a stranger halfway through a login
 * cannot read a JSON error body.
 */

export interface OAuthRouteOptions {
  /** Swapped in tests. Defaults to the global. */
  fetch?: typeof fetch;
}

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
const GITHUB_USER = 'https://api.github.com/user';

/** GitHub rejects API requests that do not identify themselves. */
const USER_AGENT = 'batcave-mcp';

/** All this server can offer, and all any grant gets. */
const SCOPES = ['tasks'];

interface GithubUser {
  login: string;
  name: string | null;
}

export function createOAuthRoutes(options: OAuthRouteOptions = {}): Hono<AppEnv> {
  const route = new Hono<AppEnv>();
  const fetchImpl = options.fetch ?? fetch;

  /**
   * A plain-text page rather than JSON. Everything here is read by a person in
   * a browser mid-login, not by the MCP client, which is off waiting on a
   * redirect it will never get.
   */
  const fail = (message: string, status: 400 | 502) =>
    new Response(`${message}\n`, {
      status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });

  /** `__Host-` needs Secure, and Secure needs https. Localhost gets the plain name. */
  const secure = (url: URL) => url.protocol === 'https:';

  const cookieOptions = (url: URL) =>
    ({
      httpOnly: true,
      secure: secure(url),
      sameSite: 'Lax',
      path: '/',
      maxAge: STATE_TTL_SECONDS,
    }) as const;

  /**
   * The half of the flow that is the same however the user got here: remember
   * the authorization request under a single-use token, bind that token to this
   * browser with a signed cookie, and hand off to GitHub.
   *
   * Shared by the consent POST and by the first-party fast path, so the two
   * cannot drift — and in particular so skipping the consent page can never
   * mean skipping the state binding that protects the callback.
   */
  const toGithub = async (c: Context<AppEnv>, request: AuthRequest) => {
    const url = new URL(c.req.url);
    const token = newToken();
    await putState(c.env.OAUTH_KV, token, request);
    await setSignedCookie(c, STATE_COOKIE, token, c.env.COOKIE_ENCRYPTION_KEY, cookieOptions(url));

    const github = new URL(GITHUB_AUTHORIZE);
    github.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID);
    github.searchParams.set('redirect_uri', new URL('/callback', url).toString());
    // The narrowest scope that still yields a login: no repositories, no email,
    // no organisations. All this server needs is a name to attribute a grant to.
    github.searchParams.set('scope', 'read:user');
    github.searchParams.set('state', token);

    return c.redirect(github.toString(), 302);
  };

  route.get('/authorize', async (c) => {
    let request: AuthRequest;
    try {
      request = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
    } catch {
      // An unregistered client, a redirect URI that does not match, a missing
      // PKCE challenge. Rendered here rather than redirected: until the client
      // and its redirect URI are known to be genuine, sending anything to that
      // URI is doing an attacker's forwarding for them.
      return fail(ERRORS.OAUTH_INVALID_REQUEST, 400);
    }

    const client = await c.env.OAUTH_PROVIDER.lookupClient(request.clientId);
    if (!client) return fail(ERRORS.OAUTH_INVALID_REQUEST, 400);

    // The frontend asking for access to the frontend is not a delegation, and
    // "Allow Batcave to access Batcave?" only teaches people to click through
    // consent screens without reading them. Third-party clients still get the
    // page; only this one, whose id this server issued itself, is waved past.
    // Nothing else is skipped with it: `toGithub` still binds the state to this
    // browser, which is what the callback actually checks.
    if (request.clientId === (await ensureWebClient(c.env))) return toGithub(c, request);

    const nonce = newToken();
    const url = new URL(c.req.url);
    await setSignedCookie(
      c,
      CONSENT_COOKIE,
      nonce,
      c.env.COOKIE_ENCRYPTION_KEY,
      cookieOptions(url),
    );

    return c.html(
      renderConsentPage({
        clientName: client.clientName ?? request.clientId,
        clientUri: client.clientUri,
        scopes: request.scope.length > 0 ? request.scope : SCOPES,
        nonce,
        // The same query, so the POST re-parses the identical request rather
        // than trusting a serialised copy the browser could have edited.
        action: `/authorize${url.search}`,
      }),
    );
  });

  route.post('/authorize', async (c) => {
    const form = await c.req.formData();
    const submitted = form.get('nonce');
    const issued = await getSignedCookie(c, c.env.COOKIE_ENCRYPTION_KEY, CONSENT_COOKIE);

    // Double submit: the attacker's page can forge the body but cannot read
    // the cookie, so a POST that carries both came from the page we served.
    if (!issued || typeof submitted !== 'string' || submitted !== issued) {
      return fail(ERRORS.OAUTH_CONSENT_EXPIRED, 400);
    }

    deleteCookie(c, CONSENT_COOKIE, { path: '/' });

    if (form.get('decision') !== 'approve') return fail(ERRORS.GITHUB_DENIED, 400);

    let request: AuthRequest;
    try {
      request = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
    } catch {
      return fail(ERRORS.OAUTH_INVALID_REQUEST, 400);
    }

    return toGithub(c, request);
  });

  route.get('/callback', async (c) => {
    const url = new URL(c.req.url);
    if (url.searchParams.get('error')) return fail(ERRORS.GITHUB_DENIED, 400);

    const returned = url.searchParams.get('state');
    const issued = await getSignedCookie(c, c.env.COOKIE_ENCRYPTION_KEY, STATE_COOKIE);

    // The browser coming back has to be the one that left. Without this, an
    // attacker can run their own GitHub login inside someone else's session and
    // the client ends up holding a grant for the wrong account.
    if (!returned || !issued || returned !== issued) return fail(ERRORS.OAUTH_STATE_INVALID, 400);

    const request = await takeState(c.env.OAUTH_KV, returned);
    if (!request) return fail(ERRORS.OAUTH_STATE_INVALID, 400);

    deleteCookie(c, STATE_COOKIE, { path: '/' });

    const code = url.searchParams.get('code');
    if (!code) return fail(ERRORS.OAUTH_INVALID_REQUEST, 400);

    const accessToken = await exchangeCode(fetchImpl, c.env, code, new URL('/callback', url));
    if (!accessToken) return fail(ERRORS.GITHUB_EXCHANGE_FAILED, 502);

    const user = await fetchUser(fetchImpl, accessToken);
    if (!user) return fail(ERRORS.GITHUB_USER_FAILED, 502);

    const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
      request,
      // Stable within this app. A GitHub login can be renamed, and the numeric
      // id would survive that; the login is what the grant list has to be
      // readable by, and this is a single-tenant demo.
      userId: user.login,
      metadata: { label: user.name ?? user.login },
      scope: SCOPES,
      // What `getMcpAuthContext().props` returns inside a tool. The GitHub
      // access token is deliberately not here: it was needed for one call and
      // keeping it would put a credential in every grant record for nothing.
      props: { login: user.login, name: user.name },
    });

    return c.redirect(redirectTo, 302);
  });

  return route;
}

/**
 * GitHub answers a bad code with HTTP 200 and an `error` field, so the status
 * is not the thing to check.
 */
async function exchangeCode(
  fetchImpl: typeof fetch,
  env: Env,
  code: string,
  redirectUri: URL,
): Promise<string | null> {
  const response = await fetchImpl(GITHUB_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri.toString(),
    }),
  });

  if (!response.ok) return null;

  const body = (await response.json()) as { access_token?: string; error?: string };
  return body.access_token ?? null;
}

async function fetchUser(fetchImpl: typeof fetch, token: string): Promise<GithubUser | null> {
  const response = await fetchImpl(GITHUB_USER, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': USER_AGENT,
    },
  });

  if (!response.ok) return null;

  const body = (await response.json()) as Partial<GithubUser>;
  return typeof body.login === 'string' ? { login: body.login, name: body.name ?? null } : null;
}
