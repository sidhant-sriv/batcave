/**
 * Where the Worker is.
 *
 * Its own module because both `api/client.ts` and `auth/session.ts` need it and
 * they already point at each other — the client asks the session for a token,
 * the session asks the Worker for one. Keeping the constant out of both breaks
 * what would otherwise be an import cycle for the sake of one string.
 */
export const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
