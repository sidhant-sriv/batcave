/**
 * Wraps a D1 binding so chosen statements fail, which is how the failure tests
 * reach the code paths that only a broken database can produce.
 */
function proxyPrepare(
  db: D1Database,
  intercept: (sql: string) => D1PreparedStatement | undefined,
): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql: string) => intercept(sql) ?? db.prepare(sql);
      }
      const value = Reflect.get(target, property) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Throws on any statement containing `fragment`. */
export function dbFailingOn(db: D1Database, fragment: string): D1Database {
  return proxyPrepare(db, (sql) => {
    if (sql.includes(fragment)) throw new Error('D1_UNAVAILABLE');
    return undefined;
  });
}

/**
 * Lets a task insert commit, then kills the checkpointer write that would
 * record the tool call as finished. That is the one window §7.3 leaves open:
 * the row exists, but a resumed run does not know the tool already ran, so it
 * runs it again. Nothing else should be able to produce a duplicate task.
 */
export function dbLosingWriteAfterInsert(db: D1Database): D1Database {
  let inserted = false;
  return proxyPrepare(db, (sql) => {
    if (sql.includes('INSERT INTO tasks')) {
      inserted = true;
      return undefined;
    }
    if (inserted && sql.includes('INTO writes')) throw new Error('D1_UNAVAILABLE');
    return undefined;
  });
}
