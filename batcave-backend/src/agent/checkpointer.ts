import { CloudflareD1Saver } from 'langgraph-checkpoint-cloudflare-d1';

/**
 * A view of the database whose `exec` does nothing. `prepare`, `batch` and the
 * rest pass straight through, bound to the real binding.
 */
function withoutDdl(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'exec') {
        return async () => ({ count: 0, duration: 0 });
      }
      // Read against the target, not the proxy, so native accessors keep their
      // receiver; bind methods for the same reason.
      const value = Reflect.get(target, property) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * The base saver runs `CREATE TABLE IF NOT EXISTS` twice plus two `ALTER TABLE`
 * attempts the first time any method is called — four D1 round trips, and a
 * Worker builds a fresh saver per request. Migration 0002 owns that schema
 * instead.
 *
 * `setup()` is not simply overridden because it also caches the two prepared
 * statements `getTuple` and `list` depend on. Those go through `prepare`, the
 * DDL goes through `exec`, so suppressing `exec` removes the round trips and
 * leaves everything else intact. That is tied to the saver's internals, which
 * is why its version is pinned exactly in package.json.
 */
export class D1Saver extends CloudflareD1Saver {
  constructor(db: D1Database) {
    super(withoutDdl(db));
  }
}
