/**
 * Whose data a service is allowed to touch.
 *
 * Every service takes one of these, so there is no way to construct a
 * `TaskService` without answering the question. That is the whole mechanism:
 * forgetting to scope a query is a type error at the call site rather than
 * something a reviewer has to notice in the SQL.
 *
 * `SYSTEM` has exactly one caller — the Workflow, which wakes on a schedule its
 * user created long before the request that made it, and has no identity to
 * carry. It is a symbol rather than a string so that no value derived from a
 * request can ever become it: there is no header, no token claim and no D1
 * column that could parse into `SYSTEM` by accident.
 *
 * Lives at the top level beside `errors.ts` and `ids.ts` rather than under
 * `services/`, because `db/` needs it too and `db/` must not import upwards.
 */
export const SYSTEM = Symbol('system');

/** A GitHub login, or the Workflow acting for nobody. */
export type Actor = string | typeof SYSTEM;
