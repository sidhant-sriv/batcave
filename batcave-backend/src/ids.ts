/**
 * UUID generation. Workers' `crypto.randomUUID()` only emits v4, which is
 * unordered and cannot be derived, so both variants are built by hand here.
 * Shared rather than agent-local so `TaskService` need not import from
 * `agent/`.
 */

/** Stamp the RFC 9562 version and variant bits into a 16-byte buffer. */
function stamp(bytes: Uint8Array, version: number): string {
  bytes[6] = (bytes[6]! & 0x0f) | (version << 4);
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * UUIDv7: 48-bit millisecond timestamp then randomness, so ids sort by
 * creation time and inserts land at the end of the primary-key index instead
 * of scattering across it. Used wherever there is nothing to derive an id
 * from. Nothing leaks: a task's creation time is already a column.
 */
export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const now = Date.now();
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((BigInt(now) >> BigInt(8 * (5 - i))) & 0xffn);
  }

  return stamp(bytes, 7);
}

/**
 * UUIDv8 derived from a name. Version 8 is RFC 9562's slot for
 * implementation-defined layouts, which is what a SHA-256 truncation is;
 * version 5 would be a lie, since it specifically means name-based SHA-1.
 *
 * Hashed rather than used raw because the names we derive from (Groq tool
 * call ids) are short strings with no cross-response uniqueness guarantee,
 * and the result becomes a permanent primary key.
 */
export async function derivedUuid(namespace: string, name: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${namespace}:${name}`),
  );

  return stamp(new Uint8Array(digest).slice(0, 16), 8);
}
