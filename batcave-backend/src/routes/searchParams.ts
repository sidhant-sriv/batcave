/**
 * Normalises Hono's `Record<string, string[]>` query bag into the shape
 * `searchTasksSchema` expects. Arrays are accepted both as repeated keys
 * (`?status=todo&status=in_progress`) and comma-separated
 * (`?status=todo,in_progress`). Pure, so it is testable without a request.
 */
export function parseSearchQuery(queries: Record<string, string[]>): Record<string, unknown> {
  const filters: Record<string, unknown> = {};

  for (const key of ['query', 'due_from', 'due_to', 'limit'] as const) {
    const value = queries[key]?.[0];
    if (value !== undefined) filters[key] = value;
  }

  for (const key of ['status', 'priority'] as const) {
    if (queries[key] === undefined) continue;
    const values = queries[key]
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean);
    // An empty or whitespace-only value is a malformed filter, not "no filter";
    // passing the empty array through lets the schema's .min(1) reject it.
    filters[key] = values;
  }

  return filters;
}
