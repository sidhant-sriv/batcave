import { describe, expect, it } from 'vitest';
import { ERRORS } from '../../src/errors';
import { toolResult } from '../../src/mcp/result';
import {
  NotificationNotFoundError,
  ScheduleNotFoundError,
  ScheduleValidationError,
} from '../../src/services/scheduleService';
import { TaskNotFoundError, TaskValidationError } from '../../src/services/taskService';

/**
 * The line between "you asked wrong" and "we broke". Getting it wrong in either
 * direction is worse than the failure itself: an infrastructure outage reported
 * as `isError` sends the model back to reword its arguments forever, and a bad
 * argument reported as a protocol error hides the reason from it entirely.
 */

const parse = (result: { content: Array<{ text: string }> }) =>
  JSON.parse(result.content[0]!.text) as Record<string, unknown>;

describe('toolResult', () => {
  it('wraps a success as ok:true alongside the payload', async () => {
    const result = await toolResult('create_task', async () => ({ task: { id: 'a1' } }));

    expect(result.isError).toBeUndefined();
    expect(parse(result)).toEqual({ ok: true, task: { id: 'a1' } });
  });

  it('reports a correctable failure as a tool error the model can read', async () => {
    const result = await toolResult('update_task', async () => {
      throw new TaskNotFoundError('a1');
    });

    expect(result.isError).toBe(true);
    expect(parse(result)).toEqual({ ok: false, error: ERRORS.TASK_NOT_FOUND });
  });

  it('carries validation issues through, so the model can see which field', async () => {
    const issues = [{ path: ['title'], message: ERRORS.TASK_TITLE_REQUIRED }];
    const result = await toolResult('create_task', async () => {
      throw new TaskValidationError(ERRORS.INVALID_TASK_INPUT, issues);
    });

    expect(result.isError).toBe(true);
    expect(parse(result)).toMatchObject({ ok: false, error: ERRORS.INVALID_TASK_INPUT, issues });
  });

  it('treats every schedule refusal the same way', async () => {
    for (const error of [
      new ScheduleValidationError(ERRORS.SCHEDULE_CRON_TOO_FREQUENT),
      new ScheduleNotFoundError('a1'),
      new NotificationNotFoundError('n1'),
    ]) {
      const result = await toolResult('schedule_recurring', async () => {
        throw error;
      });
      expect(result.isError).toBe(true);
      expect(parse(result).error).toBe(error.message);
    }
  });

  it('never puts an internal failure on the wire', async () => {
    // The SDK turns a thrown error into an `isError` result carrying its
    // message, so rethrowing would hand the caller `D1_UNAVAILABLE` and tell
    // it the arguments were wrong. It gets a generic refusal instead, and the
    // real cause goes to the log.
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);

    try {
      const result = await toolResult('create_task', async () => {
        throw new Error('D1_UNAVAILABLE');
      });

      expect(result.isError).toBe(true);
      expect(parse(result)).toEqual({ ok: false, error: ERRORS.MCP_TOOL_UNAVAILABLE });
      expect(result.content[0]!.text).not.toContain('D1_UNAVAILABLE');
      expect(logged[0]?.[0]).toContain('create_task');
    } finally {
      console.error = original;
    }
  });
});
