import { BASE_URL } from '@/api/base';
import { challengeFor, createVerifier, randomState } from './pkce';

/**
 * The session: where the tokens live, and every way one is obtained or lost.
 *
 * Deliberately not a hook. `api/client.ts` needs a token on every request and a
 * refresh on every 401, and neither of those happens inside a render;
 * `AuthProvider` subscribes to this rather than owning it.
 *
 * WHERE THE TOKENS LIVE, AND WHY. The access token is held in memory only, so a
 * reload throws it away. The refresh token goes to `localStorage`, which any
 * script on this origin can read — that is the real cost of a cross-site API,
 * and it is worth stating rather than burying. A same-origin deployment could
 * use an `HttpOnly` cookie and be strictly safer; this frontend is on
 * `pages.dev` and the Worker on `workers.dev`, which are separate sites, so a
 * cookie between them would need `SameSite=None` and Safari would drop it.
 * Bearer tokens are what remains, and this is where the trade is paid.
 *
 * The refresh token ROTATES: every exchange returns a new one and invalidates
 * the old, so a refresh that stores nothing logs the user out on their next
 * reload.
 */

/** Survives a reload. Rotated on every refresh. */
const REFRESH_KEY = 'batcave.refresh';

/** Survive only the redirect to GitHub and back, in this tab. */
const VERIFIER_KEY = 'batcave.pkce.verifier';
const STATE_KEY = 'batcave.pkce.state';
const RETURN_KEY = 'batcave.pkce.return';

/** Where our router handles the code. Must match what the Worker registered. */
const CALLBACK_PATH = '/auth/callback';

export interface SessionUser {
  login: string;
  name: string | null;
}

interface AuthConfig {
  client_id: string;
  authorization_endpoint: string;
  token_endpoint: string;
  scope: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/* --- state ---------------------------------------------------------------- */

let accessToken: string | null = null;
const listeners = new Set<() => void>();

const announce = () => listeners.forEach((listener) => listener());

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getAccessToken = (): string | null => accessToken;

/**
 * Every storage access is guarded. A browser in private mode, or one told to
 * block site data, throws on the accessor itself rather than returning null,
 * and a sign-in screen that crashes is worse than one that cannot remember you.
 */
function read(key: string, store: Storage): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null, store: Storage): void {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    /* Nothing to do: the session simply will not survive a reload. */
  }
}

const storeTokens = (tokens: TokenResponse) => {
  accessToken = tokens.access_token;
  if (tokens.refresh_token) write(REFRESH_KEY, tokens.refresh_token, localStorage);
  announce();
};

export function forget(): void {
  accessToken = null;
  write(REFRESH_KEY, null, localStorage);
  announce();
}

/* --- discovery ------------------------------------------------------------ */

let configPromise: Promise<AuthConfig> | null = null;

/**
 * The client id and endpoints, asked for once. The Worker registers the
 * frontend as a client on the first call, so this is also what makes a fresh
 * deployment work with no configuration.
 */
export function authConfig(): Promise<AuthConfig> {
  configPromise ??= fetch(`${BASE_URL}/api/auth/config`).then(async (response) => {
    if (!response.ok) throw new Error('Could not reach the sign-in service');
    return (await response.json()) as AuthConfig;
  });

  // Not cached across failures, or one flaky load would break sign-in until
  // the tab is closed.
  return configPromise.catch((error: unknown) => {
    configPromise = null;
    throw error;
  });
}

/* --- signing in ----------------------------------------------------------- */

/** Leaves the page. Everything after this happens in `completeSignIn`. */
export async function beginSignIn(returnTo: string = location.pathname + location.search) {
  const config = await authConfig();
  const verifier = createVerifier();
  const state = randomState();

  write(VERIFIER_KEY, verifier, sessionStorage);
  write(STATE_KEY, state, sessionStorage);
  write(RETURN_KEY, returnTo, sessionStorage);

  const url = new URL(config.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.client_id);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', await challengeFor(verifier));
  url.searchParams.set('code_challenge_method', 'S256');

  location.assign(url.toString());
}

/**
 * The other half, run by the callback route. Returns where to go next.
 *
 * MEMOISED PER PAGE LOAD, and that is not an optimisation. Both halves of this
 * are single use — the authorization code, and the verifier this reads out of
 * `sessionStorage` and immediately clears — so a second call cannot succeed
 * even though the first did. React's StrictMode runs every effect twice in
 * development, which is exactly that scenario: the first call would exchange
 * the code and store the tokens while the second reported "this sign-in did not
 * start in this tab", leaving someone signed in and looking at an error.
 * Sharing one promise makes both callers see the same answer.
 */
let completion: Promise<string> | null = null;

export function completeSignIn(params: URLSearchParams): Promise<string> {
  completion ??= exchange(params);
  return completion;
}

async function exchange(params: URLSearchParams): Promise<string> {
  const error = params.get('error');
  if (error) throw new Error(describe(error));

  const code = params.get('code');
  const returned = params.get('state');
  const verifier = read(VERIFIER_KEY, sessionStorage);
  const expected = read(STATE_KEY, sessionStorage);
  const returnTo = read(RETURN_KEY, sessionStorage) ?? '/tasks';

  write(VERIFIER_KEY, null, sessionStorage);
  write(STATE_KEY, null, sessionStorage);
  write(RETURN_KEY, null, sessionStorage);

  // A state that does not match is a code delivered to a tab that did not ask
  // for one, which is the attack `state` exists to stop. Not a retryable error.
  if (!code || !verifier || !expected || returned !== expected) {
    throw new Error('That sign-in did not start in this tab. Try again.');
  }

  const config = await authConfig();
  storeTokens(
    await postToken(config.token_endpoint, {
      grant_type: 'authorization_code',
      code,
      client_id: config.client_id,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    }),
  );

  return returnTo;
}

/* --- keeping it ----------------------------------------------------------- */

let refreshing: Promise<boolean> | null = null;

/**
 * Trades the stored refresh token for a new access token, and for a new refresh
 * token to replace it. Concurrent callers share one attempt: without that, a
 * page that fires six queries at once would spend five rotated tokens on
 * requests that were already going to fail.
 */
export function refresh(): Promise<boolean> {
  refreshing ??= attemptRefresh().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function attemptRefresh(): Promise<boolean> {
  const token = read(REFRESH_KEY, localStorage);
  if (!token) return false;

  try {
    const config = await authConfig();
    storeTokens(
      await postToken(config.token_endpoint, {
        grant_type: 'refresh_token',
        refresh_token: token,
        client_id: config.client_id,
      }),
    );
    return true;
  } catch {
    // Expired, revoked, or minted by a deployment this one no longer shares a
    // KV with. All of them mean the same thing: sign in again.
    forget();
    return false;
  }
}

/** What `AuthProvider` calls on mount: pick the session back up, or do not. */
export async function restore(): Promise<boolean> {
  if (accessToken) return true;
  return refresh();
}

/* --- signing out ---------------------------------------------------------- */

/**
 * Revokes before forgetting. Dropping the token locally would be enough for
 * this browser and would leave a usable refresh token alive on the server for
 * thirty days; revocation is one request and closes that.
 */
export async function signOut(): Promise<void> {
  const token = read(REFRESH_KEY, localStorage);

  if (token) {
    try {
      const config = await authConfig();
      await fetch(config.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, client_id: config.client_id }).toString(),
      });
    } catch {
      /* Best effort. A revocation that fails must not strand someone signed in. */
    }
  }

  forget();
}

/* --- plumbing ------------------------------------------------------------- */

const redirectUri = () => new URL(CALLBACK_PATH, location.origin).toString();

async function postToken(endpoint: string, body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { error_description?: string };
    throw new Error(detail.error_description ?? 'Could not complete sign-in');
  }

  return (await response.json()) as TokenResponse;
}

/** The two `error` values GitHub and the authorization server actually send. */
const describe = (code: string) =>
  code === 'access_denied' ? 'Sign-in was cancelled.' : `Sign-in failed (${code}).`;
