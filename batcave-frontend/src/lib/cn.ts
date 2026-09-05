/**
 * Class name joiner. Deliberately not `clsx` — this is the whole feature, and a
 * dependency for eight lines is a dependency to keep updated forever.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
