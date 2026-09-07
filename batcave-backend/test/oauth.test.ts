import { SELF, createExecutionContext, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ERRORS } from '../src/errors';
import { createWorker } from '../src/index';
import type { Env } from '../src/types/task';
import { CookieJar, pkce, stubbedGithub, type GithubStub } from './helpers/github';
import { parse } from './helpers/mcp';
import { resetDb } from './helpers/reset';

/**
 * The door on the MCP endpoint, end to end.
 *
 * The point of this suite is that the flow works as a client will actually
 * drive it: discovery, registration, consent, the GitHub round trip, the token
 * exchange, and only then a tool call. Asserting the pieces in isolation would
 * miss the thing most likely to be wrong, which is whether they fit together.
 *
 * Two ways in, for one reason. `SELF` runs the real Worker, which is what makes
 * the 401 and the metadata documents worth asserting — but it cannot be handed
 * a stubbed GitHub. So the browser-facing legs run against a Worker built here
 * with the stub. Both share the same `OAUTH_KV`, so a token minted through one
 * is accepted by the other, which is itself worth knowing.
 */

beforeEach(resetDb);

const REDIRECT = 'https://client.test/callback';

function workerWith(github: GithubStub) {
  const worker = createWorker({ fetch: github.fetch });

  return (path: string, init: RequestInit = {}) =>
    worker.fetch(
      new Request(`https://test${path}`, init),
      // Spread, because the library assigns OAUTH_PROVIDER onto the env it is
      // given and `cloudflare:test`'s env is frozen.
      { ...env } as Env,
      createExecutionContext(),
    );
}

const json = async (response: Response) => (await response.json()) as Record<string, any>;

/** Registers a client the way a client without pre-registration would. */
async function registerClient(
  call: ReturnType<typeof workerWith>,
  clientName = 'Test Client',
): Promise<string> {
  const response = await call('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    }),
  });

  expect(response.status).toBe(201);
  return (await json(response)).client_id as string;
}

describe('discovery', () => {
  it('challenges an unauthenticated MCP call and says where to authorize', async () => {
    const response = await SELF.fetch('https://test/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });

    expect(response.status).toBe(401);
    // The whole discovery chain hangs off this header. Without it a client has
    // nowhere to start and simply reports that the server is broken.
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://test/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it('publishes protected resource metadata derived from the request', async () => {
    const body = await json(
      await SELF.fetch('https://test/.well-known/oauth-protected-resource/mcp'),
    );

    expect(body.resource).toBe('https://test/mcp');
    expect(body.authorization_servers).toEqual(['https://test']);
    expect(body.scopes_supported).toEqual(['tasks']);
    expect(body.resource_name).toBe('Batcave');
  });

  it('publishes authorization server metadata a client can act on', async () => {
    const body = await json(await SELF.fetch('https://test/.well-known/oauth-authorization-server'));

    expect(body.authorization_endpoint).toBe('https://test/authorize');
    expect(body.token_endpoint).toBe('https://test/oauth/token');
    expect(body.registration_endpoint).toBe('https://test/oauth/register');
    // Public clients cannot keep a secret, so PKCE is the only thing standing
    // between a stolen authorization code and a token.
    expect(body.code_challenge_methods_supported).toContain('S256');
  });

  it('challenges the REST API too, with a body the frontend can read', async () => {
    const response = await SELF.fetch('https://test/api/tasks?limit=1');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    // JSON rather than the RFC 9728 challenge `/mcp` answers with: this one is
    // read by `ApiError` in the frontend, not by a client running discovery.
    expect((await json(response)).error).toBe(ERRORS.UNAUTHORIZED);
  });
});

describe('the authorize page', () => {
  it('refuses a client it has never seen, without redirecting anywhere', async () => {
    const call = workerWith(stubbedGithub());
    const response = await call(
      `/authorize?response_type=code&client_id=nope&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=tasks&state=abc`,
    );

    expect(response.status).toBe(400);
    // Redirecting an unvalidated redirect_uri would make this an open redirect.
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain(ERRORS.OAUTH_INVALID_REQUEST);
  });

  it('escapes the client name, which the client chose', async () => {
    const call = workerWith(stubbedGithub());
    const clientId = await registerClient(call, '<script>alert(1)</script>');
    const { challenge } = await pkce();

    const response = await call(
      `/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=tasks&state=abc&code_challenge=${challenge}&code_challenge_method=S256`,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('&lt;script&gt;');
    expect(body).not.toContain('<script>alert(1)</script>');
  });

  it('refuses an approval that did not come from the page it served', async () => {
    const call = workerWith(stubbedGithub());
    const clientId = await registerClient(call);

    // No consent cookie: this is what a cross-site POST looks like.
    const response = await call(
      `/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=tasks&state=abc`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ nonce: 'made-up', decision: 'approve' }).toString(),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(ERRORS.OAUTH_CONSENT_EXPIRED);
  });
});

describe('the whole flow', () => {
  /** Everything up to the redirect back to the client, returning its code. */
  async function authorize(github: GithubStub) {
    const call = workerWith(github);
    const jar = new CookieJar();
    const clientId = await registerClient(call);
    const { verifier, challenge } = await pkce();

    const query =
      `response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}` +
      `&scope=tasks&state=client-state&code_challenge=${challenge}&code_challenge_method=S256`;

    const consent = await call(`/authorize?${query}`);
    expect(consent.status).toBe(200);
    jar.absorb(consent);

    const nonce = /name="nonce" value="([^"]+)"/.exec(await consent.text())?.[1];
    expect(nonce).toBeTruthy();

    const approved = await call(`/authorize?${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header },
      body: new URLSearchParams({ nonce: nonce!, decision: 'approve' }).toString(),
    });
    jar.absorb(approved);

    expect(approved.status).toBe(302);
    const toGithub = new URL(approved.headers.get('location')!);
    expect(toGithub.origin).toBe('https://github.com');
    expect(toGithub.searchParams.get('scope')).toBe('read:user');
    expect(toGithub.searchParams.get('redirect_uri')).toBe('https://test/callback');

    const state = toGithub.searchParams.get('state')!;
    const callback = await call(`/callback?code=gh-code&state=${state}`, {
      headers: { cookie: jar.header },
    });
    jar.absorb(callback);

    return { call, clientId, verifier, callback, state, jar };
  }

  it('signs in through GitHub and comes back with a code for the client', async () => {
    const github = stubbedGithub({ login: 'octocat', name: 'Octo Cat' });
    const { callback } = await authorize(github);

    expect(callback.status).toBe(302);
    const back = new URL(callback.headers.get('location')!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('code')).toBeTruthy();
    // The client's own state has to survive the round trip, or it will reject
    // the response as a forgery.
    expect(back.searchParams.get('state')).toBe('client-state');

    // What GitHub was actually sent. Each of these is something GitHub would
    // reject, and a stub that ignored them would hide a real bug.
    expect(github.tokenRequests[0]!.body).toMatchObject({
      client_id: 'test-github-client',
      client_secret: 'test-github-secret',
      code: 'gh-code',
      redirect_uri: 'https://test/callback',
    });
    expect(github.userRequests[0]!.headers.get('user-agent')).toBeTruthy();
    expect(github.userRequests[0]!.headers.get('authorization')).toBe('Bearer gho_test');
  });

  it('exchanges the code for a token that the real Worker then accepts', async () => {
    const github = stubbedGithub({ login: 'octocat' });
    const { call, clientId, verifier, callback } = await authorize(github);

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

    expect(token.status).toBe(200);
    const { access_token } = await json(token);
    expect(access_token).toBeTruthy();

    // Through SELF this time: the grant is in KV, so the deployed Worker
    // honours a token minted by the one built in this test.
    const call2 = await SELF.fetch('https://test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });

    expect(call2.status).toBe(200);
    // A modern exchange may answer as JSON or as one SSE frame; both are the
    // same result, and a client has to accept either.
    const body = await parse(call2);
    expect(body.result.tools).toHaveLength(6);
  });

  it('refuses the wrong PKCE verifier', async () => {
    const github = stubbedGithub();
    const { call, clientId, callback } = await authorize(github);
    const code = new URL(callback.headers.get('location')!).searchParams.get('code')!;

    const token = await call('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_verifier: 'not-the-verifier',
      }).toString(),
    });

    expect(token.status).toBeGreaterThanOrEqual(400);
  });
});

describe('the callback refuses', () => {
  it('a state that did not start in this browser', async () => {
    const call = workerWith(stubbedGithub());

    // A real-looking state, but no cookie to pair it with: this is the
    // login-CSRF an attacker runs to plant their own account in your session.
    const response = await call('/callback?code=gh-code&state=some-token');

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(ERRORS.OAUTH_STATE_INVALID);
  });

  it('a replay of a callback that already completed', async () => {
    const github = stubbedGithub();
    const call = workerWith(github);
    const jar = new CookieJar();
    const clientId = await registerClient(call);
    const { challenge } = await pkce();
    const query =
      `response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}` +
      `&scope=tasks&state=abc&code_challenge=${challenge}&code_challenge_method=S256`;

    const consent = await call(`/authorize?${query}`);
    jar.absorb(consent);
    const nonce = /name="nonce" value="([^"]+)"/.exec(await consent.text())![1]!;

    const approved = await call(`/authorize?${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header },
      body: new URLSearchParams({ nonce, decision: 'approve' }).toString(),
    });
    jar.absorb(approved);
    const state = new URL(approved.headers.get('location')!).searchParams.get('state')!;

    const first = await call(`/callback?code=gh-code&state=${state}`, {
      headers: { cookie: jar.header },
    });
    expect(first.status).toBe(302);

    // The state record is deleted on read, so the same callback cannot mint a
    // second grant even with the cookie still in hand.
    const second = await call(`/callback?code=gh-code&state=${state}`, {
      headers: { cookie: jar.header },
    });
    expect(second.status).toBe(400);
    expect(await second.text()).toContain(ERRORS.OAUTH_STATE_INVALID);
  });

  it('a GitHub sign-in the user cancelled', async () => {
    const call = workerWith(stubbedGithub());
    const response = await call('/callback?error=access_denied&state=whatever');

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(ERRORS.GITHUB_DENIED);
  });
});
