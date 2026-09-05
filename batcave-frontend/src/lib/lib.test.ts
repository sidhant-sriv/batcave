import { describe, expect, it } from 'vitest';
import { changedFields } from '@/api/tasks';
import type { ChatTurn, Task } from '@/api/types';
import { disambiguationOf } from './disambiguation';
import { dueBucket, dueLabel, formatDate } from './dueDate';
import { ordinalLabel, ordinalPhrase } from './ordinals';
import { relativeTime } from './time';

/**
 * The logic that decides what the interface says, tested without React or the
 * network. These are the four places a wrong answer would be invisible in a
 * screenshot but wrong in front of a user.
 */

const TODAY = '2026-09-05';

const task = (over: Partial<Task> = {}): Task => ({
  id: 'a1',
  title: 'Build the backend',
  description: null,
  status: 'todo',
  priority: 'medium',
  due_date: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('dueBucket', () => {
  it('classifies against UTC today', () => {
    expect(dueBucket('2026-09-05', 'todo', TODAY)).toBe('today');
    expect(dueBucket('2026-09-04', 'todo', TODAY)).toBe('overdue');
    expect(dueBucket('2026-09-08', 'todo', TODAY)).toBe('soon');
    expect(dueBucket('2026-09-09', 'todo', TODAY)).toBe('future');
    expect(dueBucket(null, 'todo', TODAY)).toBe('none');
  });

  it('never marks a completed task overdue', () => {
    // Finishing something late does not leave it flagged red forever: the
    // deadline stopped mattering when the work landed.
    expect(dueBucket('2026-08-01', 'done', TODAY)).toBe('future');
    expect(dueBucket('2026-08-01', 'in_progress', TODAY)).toBe('overdue');
  });

  it('labels without relying on colour', () => {
    expect(dueLabel('2026-09-05', 'today', TODAY)).toBe('TODAY');
    expect(dueLabel('2026-09-02', 'overdue', TODAY)).toBe('! 3D LATE');
    expect(dueLabel(null, 'none', TODAY)).toBe('—');
  });

  it('keeps the year only when it differs', () => {
    expect(formatDate('2026-09-11', TODAY)).toBe('11 SEP');
    expect(formatDate('2027-01-04', TODAY)).toBe('4 JAN 2027');
  });
});

describe('ordinals', () => {
  it('zero-pads for display and matches the agent’s phrasing', () => {
    expect(ordinalLabel(0)).toBe('01');
    expect(ordinalLabel(11)).toBe('12');
    expect(ordinalPhrase(0)).toBe('the first one');
    expect(ordinalPhrase(2)).toBe('the third one');
    expect(ordinalPhrase(10)).toBe('number 11');
  });
});

describe('disambiguationOf', () => {
  const search = (count: number) => ({
    tool: 'search_tasks',
    ok: true,
    tasks: Array.from({ length: count }, (_, index) => ({
      id: `t${index}`,
      title: `Task ${index}`,
      status: 'todo' as const,
      priority: 'medium' as const,
      due_date: null,
      description: null,
    })),
  });

  const turn = (over: Partial<ChatTurn>): ChatTurn => ({
    message: 'mark the report as done',
    reply: null,
    actions: [],
    ...over,
  });

  it('fires on a question after a multi-result search with no write', () => {
    const found = disambiguationOf(
      turn({ reply: 'I found two. Which one?', actions: [search(2)] }),
    );
    expect(found?.candidates).toHaveLength(2);
  });

  it('does not fire when the agent already acted', () => {
    // A trailing question after a write is a follow-up, not a blocked choice.
    expect(
      disambiguationOf(
        turn({
          reply: 'Marked it done. Anything else?',
          actions: [search(2), { tool: 'update_task', ok: true, task: task() }],
        }),
      ),
    ).toBeNull();
  });

  it('does not fire without a question, or on a single candidate', () => {
    expect(disambiguationOf(turn({ reply: 'Here they are.', actions: [search(2)] }))).toBeNull();
    expect(disambiguationOf(turn({ reply: 'Which one?', actions: [search(1)] }))).toBeNull();
    expect(disambiguationOf(turn({ reply: 'Which one?', actions: [] }))).toBeNull();
  });
});

describe('changedFields', () => {
  it('omits unchanged fields entirely', () => {
    const original = task({ title: 'Build', priority: 'high' });
    expect(changedFields(original, { title: 'Build', priority: 'high' })).toBeNull();
  });

  it('sends only what moved', () => {
    const original = task({ status: 'todo', priority: 'high' });
    expect(changedFields(original, { status: 'done', priority: 'high' })).toEqual({
      status: 'done',
    });
  });

  it('turns an emptied optional field into an explicit null', () => {
    // The backend treats absent as "leave alone" and null as "clear", so an
    // emptied input has to become null or the change is silently dropped.
    const original = task({ due_date: '2026-09-10', description: 'Notes' });
    expect(changedFields(original, { due_date: '', description: '' })).toEqual({
      due_date: null,
      description: null,
    });
  });

  it('does not resend a field that was already empty', () => {
    const original = task({ due_date: null, description: null });
    expect(changedFields(original, { due_date: '', description: '' })).toBeNull();
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-09-05T12:00:00.000Z');

  it('stays terse enough for a mono column', () => {
    expect(relativeTime('2026-09-05T11:59:30.000Z', now)).toBe('NOW');
    expect(relativeTime('2026-09-05T11:56:00.000Z', now)).toBe('4M AGO');
    expect(relativeTime('2026-09-05T09:00:00.000Z', now)).toBe('3H AGO');
    expect(relativeTime('2026-09-03T12:00:00.000Z', now)).toBe('2D AGO');
    expect(relativeTime('2026-08-01T12:00:00.000Z', now)).toBe('1 AUG');
  });
});
