import type { AuthRequest } from '@cloudflare/workers-oauth-provider';

/**
 * The two short-lived secrets the consent flow needs, and why each exists.
 *
 * CONSENT NONCE — set when the consent page is rendered, echoed back in the
 * form. Without it, a third-party page could POST the approval on a signed-in
 * user's behalf and connect its own MCP client to their account. The cookie is
 * the half an attacker cannot read, so matching them proves the POST came from
 * the page we served.
 *
 * UPSTREAM STATE — a random token carried to GitHub and back. Two jobs at once:
 * it is the key to the authorization request we parked in KV, so nothing about
 * the client's request travels through GitHub or the user's URL bar; and,
 * paired with its cookie, it proves the browser that comes back from GitHub is
 * the one that went there. Without that pairing an attacker can finish their
 * own GitHub login inside someone else's session, and the victim's MCP client
 * ends up holding a grant for the attacker's account.
 *
 * Both are one-use and expire in ten minutes. The KV record is deleted on read
 * rather than left to its TTL, so a replayed callback finds nothing.
 */

export const CONSENT_COOKIE = 'batcave_consent';
export const STATE_COOKIE = 'batcave_state';

/** Long enough for a GitHub sign-in, short enough that a leaked one is stale. */
export const STATE_TTL_SECONDS = 600;

const STATE_PREFIX = 'oauth:state:';

/** 256 bits of randomness, URL-safe. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function putState(
  kv: KVNamespace,
  token: string,
  request: AuthRequest,
): Promise<void> {
  await kv.put(STATE_PREFIX + token, JSON.stringify(request), {
    expirationTtl: STATE_TTL_SECONDS,
  });
}

/**
 * Reads the parked request and deletes it, so the same callback cannot be
 * replayed into a second grant.
 */
export async function takeState(kv: KVNamespace, token: string): Promise<AuthRequest | null> {
  const stored = await kv.get(STATE_PREFIX + token);
  if (stored === null) return null;

  await kv.delete(STATE_PREFIX + token);
  return JSON.parse(stored) as AuthRequest;
}
