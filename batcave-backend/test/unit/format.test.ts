import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { actionsOf, replyOf, taskIdsIn, turnAfter } from '../../src/agent/format';

const toolMessage = (name: string, payload: unknown) =>
  new ToolMessage({
    name,
    tool_call_id: `call_${name}`,
    content: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });

describe('replyOf', () => {
  it('takes the last assistant message that said something', () => {
    expect(
      replyOf([new AIMessage('first'), toolMessage('create_task', { ok: true }), new AIMessage('last')]),
    ).toBe('last');
  });

  it('skips the empty assistant message that carried a tool call', () => {
    const withToolCall = new AIMessage({
      content: '',
      tool_calls: [{ name: 'create_task', args: {}, id: 'call_1', type: 'tool_call' }],
    });
    expect(replyOf([new AIMessage('spoken'), withToolCall])).toBe('spoken');
  });

  it('is null when nothing was said', () => {
    expect(replyOf([toolMessage('search_tasks', { ok: true, tasks: [] })])).toBeNull();
  });
});

describe('actionsOf', () => {
  it('reports one action per tool result, with its payload', () => {
    const actions = actionsOf([
      new HumanMessage('go'),
      toolMessage('search_tasks', { ok: true, count: 1, tasks: [{ id: 'a' }] }),
      toolMessage('update_task', { ok: true, task: { id: 'a' }, changed: ['status'] }),
    ]);

    expect(actions).toEqual([
      { tool: 'search_tasks', ok: true, tasks: [{ id: 'a' }] },
      { tool: 'update_task', ok: true, task: { id: 'a' } },
    ]);
  });

  it('carries a failed envelope through', () => {
    expect(actionsOf([toolMessage('update_task', { ok: false, error: 'nope' })])).toEqual([
      { tool: 'update_task', ok: false, error: 'nope' },
    ]);
  });

  it('reports a non-JSON tool result as a failure rather than dropping it', () => {
    expect(actionsOf([toolMessage('create_task', 'Error: boom\n Please fix your mistakes.')])).toEqual(
      [{ tool: 'create_task', ok: false, error: 'Error: boom\n Please fix your mistakes.' }],
    );
  });
});

describe('taskIdsIn', () => {
  it('collects ids from search results and created tasks', () => {
    const ids = taskIdsIn([
      toolMessage('search_tasks', { ok: true, tasks: [{ id: 'a' }, { id: 'b' }] }),
      toolMessage('create_task', { ok: true, task: { id: 'c' } }),
    ]);
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('ignores ids the model only saw in its own update calls', () => {
    expect(taskIdsIn([toolMessage('update_task', { ok: true, task: { id: 'a' } })]).size).toBe(0);
  });

  it('ignores failed results', () => {
    expect(taskIdsIn([toolMessage('search_tasks', { ok: false, error: 'x' })]).size).toBe(0);
  });
});

describe('turnAfter', () => {
  it('returns everything produced after this turn started', () => {
    const messages = [
      new HumanMessage({ id: 'old', content: 'first turn' }),
      new AIMessage('first answer'),
      new HumanMessage({ id: 'this-turn', content: 'second turn' }),
      new AIMessage('second answer'),
    ];
    expect(turnAfter(messages, 'this-turn').map((m) => m.text)).toEqual(['second answer']);
  });

  it('is empty when the turn is not in the transcript', () => {
    expect(turnAfter([new AIMessage('hi')], 'missing')).toEqual([]);
    expect(turnAfter(undefined, 'missing')).toEqual([]);
  });
});
