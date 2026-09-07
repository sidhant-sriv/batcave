import { SYSTEM, type Actor } from '../actor';

/**
 * The one place the ownership predicate is spelled.
 *
 * Every statement in this directory that reads or writes a user's rows composes
 * its scope from here, so the clause and its bind can never drift apart — the
 * bug that produces is a query scoped by a parameter the caller forgot to
 * supply, which SQLite answers by matching nothing or, worse, by shifting every
 * other bind one place along.
 */

/** A WHERE predicate and the binds it needs, in the order they must be added. */
export interface Fragment {
  sql: string;
  binds: string[];
}

/** Scopes a statement to one person's rows. `SYSTEM` adds neither clause nor bind. */
export function ownerClause(owner: Actor, column = 'user_id'): Fragment {
  return owner === SYSTEM ? { sql: '', binds: [] } : { sql: `${column} = ?`, binds: [owner] };
}

/**
 * The same, for a table that reaches its owner through `tasks`.
 *
 * `schedules` and `notifications` carry no `user_id` of their own: both already
 * reference `tasks(id) ON DELETE CASCADE`, so the task is where ownership lives
 * and a second copy could only go stale. A correlated `IN` rather than a join,
 * because these are mostly `UPDATE … RETURNING` statements, where SQLite has no
 * join to hang the predicate on.
 */
export function viaTaskClause(owner: Actor, column = 'task_id'): Fragment {
  return owner === SYSTEM
    ? { sql: '', binds: [] }
    : { sql: `${column} IN (SELECT id FROM tasks WHERE user_id = ?)`, binds: [owner] };
}

/**
 * The same again, for `chat_threads`, which hangs off `chats` exactly as
 * `notifications` hangs off `tasks`.
 */
export function viaChatClause(owner: Actor, column = 'chat_id'): Fragment {
  return owner === SYSTEM
    ? { sql: '', binds: [] }
    : { sql: `${column} IN (SELECT id FROM chats WHERE user_id = ?)`, binds: [owner] };
}

/**
 * A fragment as a conjunct to append to a WHERE that is already there. Empty
 * for `SYSTEM`, which is what keeps the Workflow's statements unscoped without
 * a second version of each one.
 */
export const and = (fragment: Fragment): string => (fragment.sql ? ` AND ${fragment.sql}` : '');
