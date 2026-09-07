/**
 * PKCE, RFC 7636.
 *
 * A browser app cannot keep a client secret — anything shipped in the bundle is
 * public — so the only thing separating a stolen authorization code from a
 * token is proof that whoever redeems it also started the flow. The verifier is
 * that proof: it stays in this tab, and only its SHA-256 hash travels in the
 * redirect the browser is watched making.
 */

/** 32 bytes, which is comfortably inside the 43–128 character range the RFC allows. */
export function createVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** An opaque value for the `state` parameter, which is CSRF cover, not a secret. */
export const randomState = (): string => base64url(crypto.getRandomValues(new Uint8Array(16)));

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
