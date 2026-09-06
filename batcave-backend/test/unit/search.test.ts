import { describe, expect, it } from 'vitest';
import { buildSearchQuery, searchTerms } from '../../src/db/tasks';
import { parseSearchQuery } from '../../src/routes/searchParams';
import { searchTasksSchema } from '../../src/schemas/task';

const filters = (input: Record<string, unknown> = {}) => {
  const parsed = searchTasksSchema.safeParse(input);
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return parsed.data;
};

describe('buildSearchQuery', () => {
  it('has no WHERE clause when nothing is filtered', () => {
    const { sql, binds } = buildSearchQuery(filters());
    expect(sql).not.toContain('WHERE');
    // The only bind is the limit, requested one over so truncation is visible.
    expect(binds).toEqual([21]);
  });

  it('emits one placeholder per value in an IN list', () => {
    const { sql, binds } = buildSearchQuery(
      filters({ status: ['todo', 'in_progress'], priority: ['high'] }),
    );
    expect(sql).toContain('status IN (?, ?)');
    expect(sql).toContain('priority IN (?)');
    expect(binds).toEqual(['todo', 'in_progress', 'high', 21]);
  });

  it('bounds due dates inclusively', () => {
    const { sql, binds } = buildSearchQuery(
      filters({ due_from: '2026-08-31', due_to: '2026-09-06' }),
    );
    expect(sql).toContain('due_date >= ?');
    expect(sql).toContain('due_date <= ?');
    expect(binds).toEqual(['2026-08-31', '2026-09-06', 21]);
  });

  it('requires every term to match, in the title or the description', () => {
    const { sql, binds } = buildSearchQuery(filters({ query: 'cloudflare worker' }));
    const groups = sql.match(
      /\(t\.title LIKE \? ESCAPE '\\' OR t\.description LIKE \? ESCAPE '\\'\)/g,
    );
    expect(groups).toHaveLength(2);
    expect(binds).toEqual(['%cloudflare%', '%cloudflare%', '%worker%', '%worker%', 21]);
  });

  it('escapes LIKE metacharacters so they match literally', () => {
    const { binds } = buildSearchQuery(filters({ query: '100%_done' }));
    expect(binds[0]).toBe('%100\\%\\_done%');
  });

  it('orders dated tasks first, then by date, priority and age', () => {
    const { sql } = buildSearchQuery(filters());
    expect(sql).toContain('due_date IS NULL');
    expect(sql.indexOf('t.due_date ASC')).toBeLessThan(sql.indexOf('CASE t.priority'));
    expect(sql.indexOf('CASE t.priority')).toBeLessThan(sql.indexOf('t.created_at ASC'));
  });

  it('joins the active schedule, and only the active one', () => {
    const { sql } = buildSearchQuery(filters());
    expect(sql).toContain("LEFT JOIN schedules s ON s.task_id = t.id AND s.status = 'active'");
    expect(sql).toContain('s.next_at AS s_next_at');
  });

  it('filters on whether the join matched, and binds nothing for it', () => {
    const scheduled = buildSearchQuery(filters({ scheduled: true }));
    expect(scheduled.sql).toContain('s.id IS NOT NULL');
    expect(scheduled.binds).toEqual([21]);

    const unscheduled = buildSearchQuery(filters({ scheduled: false }));
    expect(unscheduled.sql).toContain('s.id IS NULL');
    expect(unscheduled.sql).not.toContain('s.id IS NOT NULL');
  });

  it('leaves both in when scheduled is omitted', () => {
    expect(buildSearchQuery(filters()).sql).not.toContain('s.id IS');
  });

  it('asks for one row more than the limit', () => {
    const { binds } = buildSearchQuery(filters({ limit: 5 }));
    expect(binds.at(-1)).toBe(6);
  });
});

describe('searchTerms', () => {
  it('is empty for no query', () => {
    expect(searchTerms(null)).toEqual([]);
    expect(searchTerms(undefined)).toEqual([]);
  });

  it('caps the number of terms, since more only costs a scan', () => {
    expect(searchTerms('a b c d e f g')).toEqual(['a', 'b', 'c', 'd', 'e', 'f'].slice(0, 5));
  });
});

describe('parseSearchQuery', () => {
  it('accepts arrays as repeated keys', () => {
    expect(parseSearchQuery({ status: ['todo', 'in_progress'] })).toEqual({
      status: ['todo', 'in_progress'],
    });
  });

  it('accepts arrays as one comma-separated value', () => {
    expect(parseSearchQuery({ status: ['todo,in_progress'] })).toEqual({
      status: ['todo', 'in_progress'],
    });
  });

  it('leaves absent filters absent, so schema defaults apply', () => {
    expect(parseSearchQuery({})).toEqual({});
    expect(filters(parseSearchQuery({})).limit).toBe(20);
  });

  it('rejects a present but empty filter rather than ignoring it', () => {
    const parsed = searchTasksSchema.safeParse(parseSearchQuery({ status: [''] }));
    expect(parsed.success).toBe(false);
  });
});

describe('searchTasksSchema', () => {
  it('coerces limit from a query string and caps it', () => {
    expect(filters({ limit: '50' }).limit).toBe(50);
    expect(searchTasksSchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(searchTasksSchema.safeParse({ status: ['archived'] }).success).toBe(false);
  });

  it('rejects a due bound that is not YYYY-MM-DD', () => {
    expect(searchTasksSchema.safeParse({ due_from: '31-08-2026' }).success).toBe(false);
  });

  it('reads scheduled from a query string as well as a real boolean', () => {
    expect(filters({ scheduled: 'true' }).scheduled).toBe(true);
    expect(filters({ scheduled: 'false' }).scheduled).toBe(false);
    expect(filters({ scheduled: true }).scheduled).toBe(true);
    // Absent stays absent: the filter is three-valued, not defaulted to false.
    expect(filters({}).scheduled).toBeUndefined();
  });
});
