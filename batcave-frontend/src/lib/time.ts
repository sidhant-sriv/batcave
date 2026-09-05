/**
 * Timestamp rendering for the metadata layer.
 *
 * Everything here is terse and uppercase because it is set in mono at 10–11px:
 * `4M AGO`, `12 SEP`. Long relative phrases ("about 4 minutes ago") do not fit
 * the register and do not fit the column.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** `2026-09-05T12:33:42.459Z` → `4M AGO`, `3H AGO`, `2D AGO`, `12 SEP`. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const elapsed = now - Date.parse(iso);

  if (Number.isNaN(elapsed)) return '—';
  if (elapsed < MINUTE) return 'NOW';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}M AGO`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}H AGO`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}D AGO`;

  return shortDate(iso);
}

/** `2026-09-05T…` → `5 SEP`. */
export function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];

  return `${date.getUTCDate()} ${months[date.getUTCMonth()]}`;
}

/** Full timestamp, for a `title` attribute where the terse form is ambiguous. */
export function fullTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toUTCString();
}

/**
 * The first segment of a UUID, which is what the interface shows when it needs
 * a record to feel addressable. The ids are uuidv7, so this prefix is a
 * timestamp and sorts — it is a handle, not an identifier, and is never used
 * to look anything up.
 */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
