import { describe, expect, it } from 'vitest';
import { changedFields } from '@/api/tasks';
import type { ChatTurn, Task } from '@/api/types';
import { describeCron } from './cron';
import { disambiguationOf } from './disambiguation';
import { dueBucket, dueLabel, formatDate } from './dueDate';
import { ordinalLabel, ordinalPhrase } from './ordinals';
import { clampConsoleWidth } from './prefs';
import { formatInstant, relativeTime } from './time';
import { countsOf, dayBefore, viewOf } from './views';
import { formatElapsed, pickMimeType } from './voice';

/**
 * The logic that decides what the interface says, tested without React or the
 * network. These are the four places a wrong answer would be invisible in a
 * screenshot but wrong in front of a user.
 */

const TODAY = '2026-09-05';

const task = (over: Partial<Task> = {}): Task => ({
  id: 'a1',
  user_id: 'octocat',
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

  it('counts scheduling as having acted', () => {
    // The agent that set a reminder already picked a task, so "want a second
    // one?" is a follow-up rather than a choice it is blocked on.
    expect(
      disambiguationOf(
        turn({
          reply: 'Reminder set for Friday. Anything else?',
          actions: [
            search(2),
            {
              tool: 'schedule_reminder',
              ok: true,
              schedule: {
                id: 's1',
                task_id: 't0',
                kind: 'once',
                cron: null,
                next_at: '2026-09-11T09:00:00.000Z',
                status: 'active',
                notification_count: 0,
                created_at: '2026-09-05T12:00:00.000Z',
                ended_at: null,
                task: {
                  id: 't0',
                  title: 'Task 0',
                  status: 'todo',
                  priority: 'medium',
                  due_date: null,
                  description: null,
                },
              },
            },
          ],
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

describe('formatInstant', () => {
  it('names the zone, because a bare time would be read as local', () => {
    expect(formatInstant('2026-09-12T09:00:00.000Z')).toBe('12 SEP 09:00 UTC');
    expect(formatInstant('2026-09-12T18:05:00.000Z')).toBe('12 SEP 18:05 UTC');
  });

  it('converts an offset to UTC rather than showing what it was given', () => {
    expect(formatInstant('2026-09-12T18:30:00+05:30')).toBe('12 SEP 13:00 UTC');
  });

  it('renders an unparseable value as the same dash an absent one uses', () => {
    expect(formatInstant('not a date')).toBe('—');
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

describe('describeCron', () => {
  it('reads the shapes the agent writes', () => {
    expect(describeCron('0 16 * * 5')).toBe('Every FRI 16:00');
    expect(describeCron('30 9 * * 1,3')).toBe('Every MON, WED 09:30');
    expect(describeCron('0 9 * * 1,2,3,4,5')).toBe('Weekdays 09:00');
    expect(describeCron('0 10 * * 0,6')).toBe('Weekends 10:00');
    expect(describeCron('15 6 * * *')).toBe('Daily 06:15');
    expect(describeCron('0 8 1 * *')).toBe('Monthly on the 1st, 08:00');
    expect(describeCron('0 8 22 * *')).toBe('Monthly on the 22nd, 08:00');
  });

  it('treats 0 and 7 as the same Sunday', () => {
    expect(describeCron('0 12 * * 0')).toBe('Every SUN 12:00');
    expect(describeCron('0 12 * * 7')).toBe('Every SUN 12:00');
  });

  it('returns the expression untouched when it cannot read it honestly', () => {
    // Half a translation is worse than none: each of these means something the
    // sentence form would misstate.
    expect(describeCron('*/15 * * * *')).toBe('*/15 * * * *');
    expect(describeCron('0 9-17 * * 1')).toBe('0 9-17 * * 1');
    expect(describeCron('0 9 * 3 *')).toBe('0 9 * 3 *');
    // Constraining both day fields means "either" in cron, not "both".
    expect(describeCron('0 9 1 * 1')).toBe('0 9 1 * 1');
    expect(describeCron('nonsense')).toBe('nonsense');
    expect(describeCron('0 9 * *')).toBe('0 9 * *');
  });
});

describe('saved views', () => {
  const rows = [
    task({ id: 'a', status: 'in_progress', due_date: '2026-09-04' }),
    task({ id: 'b', status: 'todo', due_date: TODAY }),
    task({ id: 'c', status: 'done', due_date: '2026-08-01' }),
    task({ id: 'd', status: 'todo', due_date: null }),
  ];

  it('counts each view the way its filter would fetch it', () => {
    expect(countsOf(rows, TODAY)).toEqual({
      all: 4,
      active: 1,
      today: 1,
      overdue: 1,
      done: 1,
    });
  });

  it('never counts finished work as due or overdue', () => {
    // The done task is a month past its date, and belongs in neither.
    const counts = countsOf([task({ status: 'done', due_date: '2026-08-01' })], TODAY);
    expect(counts.overdue).toBe(0);
    expect(counts.today).toBe(0);
  });

  it('draws the overdue boundary where the due chip does', () => {
    // `due_to` is yesterday, so a task due today is never fetched as overdue.
    expect(dayBefore(TODAY)).toBe('2026-09-04');
    expect(viewOf('overdue').filters(TODAY).due_to).toBe('2026-09-04');
  });

  it('falls back to All for an unknown view name', () => {
    expect(viewOf('nope').id).toBe('all');
    expect(viewOf(null).id).toBe('all');
  });
});

describe('pickMimeType', () => {
  const supports = (...types: string[]) => (type: string) => types.includes(type);

  it('prefers opus in webm when the browser offers a choice', () => {
    expect(pickMimeType(supports('audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'))).toBe(
      'audio/webm;codecs=opus',
    );
  });

  it('falls back to plain webm before mp4', () => {
    expect(pickMimeType(supports('audio/webm', 'audio/mp4'))).toBe('audio/webm');
  });

  it('accepts mp4, which is all Safari records', () => {
    expect(pickMimeType(supports('audio/mp4'))).toBe('audio/mp4');
  });

  // The button is hidden rather than offered and then failing.
  it('returns null when the browser records none of them', () => {
    expect(pickMimeType(() => false)).toBeNull();
  });
});

describe('formatElapsed', () => {
  it('counts whole seconds from zero', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(999)).toBe('0:00');
    expect(formatElapsed(4_200)).toBe('0:04');
  });

  it('rolls over into minutes with a padded seconds field', () => {
    expect(formatElapsed(60_000)).toBe('1:00');
    expect(formatElapsed(65_000)).toBe('1:05');
  });

  // The timer is driven by wall-clock subtraction, which can go backwards.
  it('never renders a negative time', () => {
    expect(formatElapsed(-500)).toBe('0:00');
  });
});

describe('clampConsoleWidth', () => {
  it('holds the console between its own bounds', () => {
    expect(clampConsoleWidth(500, 1600)).toBe(500);
    expect(clampConsoleWidth(120, 1600)).toBe(320);
    expect(clampConsoleWidth(2000, 1600)).toBe(720);
    expect(clampConsoleWidth(500.4, 1600)).toBe(500);
  });

  it('leaves the surface a table to be, in a window that has the room', () => {
    // 1024 - 480 = 544, so the console gives up its own maximum first.
    expect(clampConsoleWidth(720, 1024)).toBe(544);
  });

  it('keeps the console usable in a window too small for both', () => {
    // Below ~800 the two floors collide, and the console's is the one that
    // wins: a pane narrower than its composer is broken, a tight surface isn't.
    expect(clampConsoleWidth(400, 700)).toBe(320);
  });
});
