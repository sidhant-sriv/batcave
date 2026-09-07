import { describe, expect, it } from 'vitest';
import { SYSTEM } from '../../src/actor';
import { and, ownerClause, viaTaskClause } from '../../src/db/owner';

/**
 * Small enough to look obvious, which is exactly why it is tested: every
 * scoped statement in `src/db/` is built from these three functions, so a
 * clause that stops emitting its bind — or emits one without its clause —
 * would silently unscope the whole application.
 */

describe('ownerClause', () => {
  it('pairs the predicate with the bind it needs', () => {
    expect(ownerClause('octocat')).toEqual({ sql: 'user_id = ?', binds: ['octocat'] });
  });

  it('qualifies the column when a join brings a second user_id into scope', () => {
    expect(ownerClause('octocat', 't.user_id').sql).toBe('t.user_id = ?');
  });

  it('adds nothing at all for SYSTEM', () => {
    expect(ownerClause(SYSTEM)).toEqual({ sql: '', binds: [] });
  });

  it('does not share the empty fragment between calls', () => {
    const first = ownerClause(SYSTEM);
    first.binds.push('mutated');
    expect(ownerClause(SYSTEM).binds).toEqual([]);
  });
});

describe('viaTaskClause', () => {
  it('reaches the owner through the task a row hangs off', () => {
    expect(viaTaskClause('octocat')).toEqual({
      sql: 'task_id IN (SELECT id FROM tasks WHERE user_id = ?)',
      binds: ['octocat'],
    });
  });

  it('adds nothing at all for SYSTEM', () => {
    expect(viaTaskClause(SYSTEM)).toEqual({ sql: '', binds: [] });
  });
});

describe('and', () => {
  it('joins onto a WHERE that already exists', () => {
    expect(and(ownerClause('octocat'))).toBe(' AND user_id = ?');
  });

  // Without this the SYSTEM statements would end in a dangling AND.
  it('is empty when there is nothing to add', () => {
    expect(and(ownerClause(SYSTEM))).toBe('');
  });
});
