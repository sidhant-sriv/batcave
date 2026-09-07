/**
 * GitHub, without GitHub.
 *
 * The two calls the callback makes are the only network this Worker does during
 * a sign-in, so stubbing them is what lets the whole OAuth flow run in a test:
 * no real OAuth app, no browser, no rate limit. Requests are recorded so a test
 * can assert what was actually sent — the client secret, the redirect URI and
 * the user agent are all things GitHub would reject if we got them wrong, and a
 * stub that accepted anything would hide that.
 */

export interface GithubStub {
  fetch: typeof fetch;
  readonly tokenRequests: Array<{ body: Record<string, unknown>; headers: Headers }>;
  readonly userRequests: Array<{ headers: Headers }>;
}

interface StubOptions {
  login?: string;
  name?: string | null;
  /** GitHub answers a bad code with HTTP 200 and an error field. */
  exchangeError?: string;
  userStatus?: number;
}

export function stubbedGithub(options: StubOptions = {}): GithubStub {
  const tokenRequests: GithubStub['tokenRequests'] = [];
  const userRequests: GithubStub['userRequests'] = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);

    if (url.startsWith('https://github.com/login/oauth/access_token')) {
      tokenRequests.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown>, headers });
      return Response.json(
        options.exchangeError ? { error: options.exchangeError } : { access_token: 'gho_test' },
      );
    }

    if (url.startsWith('https://api.github.com/user')) {
      userRequests.push({ headers });
      if (options.userStatus && options.userStatus !== 200) {
        return new Response('nope', { status: options.userStatus });
      }
      return Response.json({
        login: options.login ?? 'octocat',
        name: options.name === undefined ? 'Octo Cat' : options.name,
      });
    }

    throw new Error(`Unexpected fetch in test: ${url}`);
  }) as unknown as typeof fetch;

  return { fetch: fetchImpl, tokenRequests, userRequests };
}

/** Carries cookies between the steps of a redirect flow, as a browser would. */
export class CookieJar {
  private readonly jar = new Map<string, string>();

  absorb(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const index = pair!.indexOf('=');
      const name = pair!.slice(0, index);
      const value = pair!.slice(index + 1);
      // An expiry in the past is a deletion, and the flow relies on those:
      // each cookie is single-use.
      if (value === '' || /Max-Age=0/i.test(header)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  get header(): string {
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

/** PKCE: a verifier and its S256 challenge. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
