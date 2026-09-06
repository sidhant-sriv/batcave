import { describe, expect, it } from 'vitest';
import { ERRORS } from '../../src/errors';
import { MIN_NOTIFICATION_GAP_MS, parseCron } from '../../src/lib/cron';

/**
 * Cron is the one place a model's output becomes a long-lived loop, so what
 * gets rejected matters as much as what parses. Pure: no D1, no Workflow.
 */

const FROM = new Date('2026-09-06T12:00:00.000Z');

const next = (expression: string, from: Date = FROM) => {
  const result = parseCron(expression, from);
  if (!result.ok) throw new Error(`expected ${expression} to parse: ${result.error}`);
  return result.schedule.nextRun(from)?.toISOString();
};

describe('parseCron', () => {
  it('resolves the next occurrence in UTC', () => {
    // 6 September 2026 is a Sunday, so the next Monday 09:00 is the 7th.
    expect(next('0 9 * * 1')).toBe('2026-09-07T09:00:00.000Z');
    expect(next('0 18 * * *')).toBe('2026-09-06T18:00:00.000Z');
    expect(next('0 9 1 * *')).toBe('2026-10-01T09:00:00.000Z');
  });

  it('advances from the time it is given, not from now', () => {
    expect(next('0 18 * * *', new Date('2026-09-06T19:00:00.000Z'))).toBe(
      '2026-09-07T18:00:00.000Z',
    );
  });

  it('rejects an expression that is not cron at all', () => {
    expect(parseCron('every monday', FROM)).toEqual({
      ok: false,
      error: ERRORS.SCHEDULE_CRON_INVALID,
    });
  });

  it('rejects a field that is out of range', () => {
    expect(parseCron('0 99 * * *', FROM)).toEqual({
      ok: false,
      error: ERRORS.SCHEDULE_CRON_INVALID,
    });
  });

  it('rejects a date that never comes round', () => {
    // 31 February.
    expect(parseCron('0 9 31 2 *', FROM)).toEqual({
      ok: false,
      error: ERRORS.SCHEDULE_CRON_NO_RUN,
    });
  });

  it('rejects anything more frequent than the floor', () => {
    for (const expression of ['* * * * *', '*/5 * * * *', '*/14 * * * *']) {
      expect(parseCron(expression, FROM)).toEqual({
        ok: false,
        error: ERRORS.SCHEDULE_CRON_TOO_FREQUENT,
      });
    }
  });

  it('accepts exactly the floor', () => {
    expect(MIN_NOTIFICATION_GAP_MS).toBe(15 * 60_000);
    expect(next('*/15 * * * *')).toBe('2026-09-06T12:15:00.000Z');
  });
});
