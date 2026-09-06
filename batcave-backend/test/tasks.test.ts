import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertTask } from '../src/db/tasks';
import { TaskNotFoundError, TaskService, TaskValidationError } from '../src/services/taskService';
import type { Task } from '../src/types/task';
import { resetDb } from './helpers/reset';

const service = () => new TaskService(env.DB);

beforeEach(resetDb);

/** Seeds rows directly so ordering and dates are exactly what a case needs. */
async function seed(rows: Array<Partial<Task> & { title: string }>): Promise<Task[]> {
  const created: Task[] = [];
  for (const [index, row] of rows.entries()) {
    const stamp = `2026-01-0${index + 1}T00:00:00.000Z`;
    created.push(
      await insertTask(env.DB, {
        id: crypto.randomUUID(),
        description: null,
        status: 'todo',
        priority: 'medium',
        due_date: null,
        created_at: stamp,
        updated_at: stamp,
        ...row,
      }),
    );
  }
  return created;
}

const json = async (response: Response) => (await response.json()) as Record<string, any>;

describe('TaskService.create', () => {
  it('generates a time-ordered id and stamps both timestamps', async () => {
    const task = await service().create({ title: 'Renew the domain' });
    expect(task.id[14]).toBe('7');
    expect(task.status).toBe('todo');
    expect(task.priority).toBe('medium');
    expect(task.created_at).toBe(task.updated_at);
  });

  it('takes a caller-supplied id, and re-inserting it returns the first row', async () => {
    const id = crypto.randomUUID();
    const first = await service().create({ title: 'Deploy the worker' }, { id });
    const second = await service().create({ title: 'A different title' }, { id });

    // The upsert exists so a retried tool call cannot create a second task.
    expect(second).toEqual(first);
    expect(second.title).toBe('Deploy the worker');
    const { tasks } = await service().search({});
    expect(tasks).toHaveLength(1);
  });

  it('rejects a due date that is not YYYY-MM-DD', async () => {
    await expect(service().create({ title: 'x', due_date: 'friday' })).rejects.toBeInstanceOf(
      TaskValidationError,
    );
  });
});

describe('TaskService.search', () => {
  beforeEach(async () => {
    await seed([
      { title: 'Finish Cloudflare assignment', priority: 'high', due_date: '2026-09-05' },
      { title: 'Build the backend API', status: 'in_progress', due_date: '2026-09-10' },
      { title: 'Write backend tests', status: 'done', priority: 'low' },
      { title: 'Buy milk', description: 'From the Cloudflare shop, oddly' },
    ]);
  });

  it('returns everything when nothing is filtered', async () => {
    const { tasks, truncated } = await service().search({});
    expect(tasks).toHaveLength(4);
    expect(truncated).toBe(false);
  });

  it('matches free text against title or description', async () => {
    const { tasks } = await service().search({ query: 'cloudflare' });
    expect(tasks.map((task) => task.title).sort()).toEqual([
      'Buy milk',
      'Finish Cloudflare assignment',
    ]);
  });

  it('requires every term to match', async () => {
    const { tasks } = await service().search({ query: 'backend tests' });
    expect(tasks.map((task) => task.title)).toEqual(['Write backend tests']);
  });

  it('treats a status list as "any of these"', async () => {
    const { tasks } = await service().search({ status: ['todo', 'in_progress'] });
    expect(tasks).toHaveLength(3);
  });

  it('bounds due dates inclusively and excludes undated tasks', async () => {
    const { tasks } = await service().search({ due_from: '2026-09-05', due_to: '2026-09-10' });
    expect(tasks).toHaveLength(2);
  });

  it('puts dated tasks first, then earliest, then highest priority', async () => {
    const { tasks } = await service().search({});
    expect(tasks.map((task) => task.title)).toEqual([
      'Finish Cloudflare assignment',
      'Build the backend API',
      // Both undated, so priority decides: medium before low.
      'Buy milk',
      'Write backend tests',
    ]);
  });

  it('reports truncation without a second count query', async () => {
    const { tasks, truncated } = await service().search({ limit: 2 });
    expect(tasks).toHaveLength(2);
    expect(truncated).toBe(true);
  });
});

/**
 * The schedule a search carries. Rows are written straight to D1 rather than
 * through ScheduleService, because what is under test is the join, not the
 * workflow that a real schedule would also start.
 */
describe('TaskService.search — schedules', () => {
  const schedule = (
    taskId: string,
    row: Partial<{ kind: string; cron: string | null; next_at: string; status: string }> = {},
  ) =>
    env.DB.prepare(
      `INSERT INTO schedules
         (id, task_id, kind, cron, next_at, status, notification_count, created_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL)`,
    )
      .bind(
        crypto.randomUUID(),
        taskId,
        row.kind ?? 'once',
        row.cron ?? null,
        row.next_at ?? '2026-09-11T09:00:00.000Z',
        row.status ?? 'active',
        '2026-09-06T00:00:00.000Z',
      )
      .run();

  it('carries the active schedule, and null when there is none', async () => {
    const [reminded, plain] = await seed([{ title: 'Renew the domain' }, { title: 'Buy milk' }]);
    await schedule(reminded!.id);

    const { tasks } = await service().search({});
    const byTitle = new Map(tasks.map((task) => [task.title, task]));

    expect(byTitle.get('Renew the domain')!.schedule).toEqual({
      kind: 'once',
      cron: null,
      next_at: '2026-09-11T09:00:00.000Z',
    });
    expect(byTitle.get('Buy milk')!.schedule).toBeNull();
  });

  it('reports a recurring schedule with its cron', async () => {
    const [task] = await seed([{ title: 'Water the plants' }]);
    await schedule(task!.id, { kind: 'recurring', cron: '0 9 * * 1' });

    const { tasks } = await service().search({});
    expect(tasks[0]!.schedule).toMatchObject({ kind: 'recurring', cron: '0 9 * * 1' });
  });

  it('ignores a cancelled schedule: it notifies nobody', async () => {
    const [task] = await seed([{ title: 'Renew the domain' }]);
    await schedule(task!.id, { status: 'cancelled' });

    const { tasks } = await service().search({});
    expect(tasks[0]!.schedule).toBeNull();
    expect((await service().search({ scheduled: true })).tasks).toHaveLength(0);
  });

  it('filters both ways on scheduled, and includes both when it is omitted', async () => {
    const [reminded] = await seed([{ title: 'Renew the domain' }, { title: 'Buy milk' }]);
    await schedule(reminded!.id);

    expect((await service().search({ scheduled: true })).tasks.map((t) => t.title)).toEqual([
      'Renew the domain',
    ]);
    expect((await service().search({ scheduled: false })).tasks.map((t) => t.title)).toEqual([
      'Buy milk',
    ]);
    expect((await service().search({})).tasks).toHaveLength(2);
  });

  it('narrows together with the other filters rather than replacing them', async () => {
    const [open, done] = await seed([
      { title: 'Renew the domain' },
      { title: 'Write backend tests', status: 'done' },
    ]);
    await schedule(open!.id);
    await schedule(done!.id, { kind: 'recurring', cron: '0 9 * * 1' });

    const { tasks } = await service().search({ scheduled: true, status: ['done'] });
    expect(tasks.map((task) => task.title)).toEqual(['Write backend tests']);
  });

  it('takes scheduled as a query param on GET /api/tasks', async () => {
    const [reminded] = await seed([{ title: 'Renew the domain' }, { title: 'Buy milk' }]);
    await schedule(reminded!.id);

    const body = await json(await SELF.fetch('https://test/api/tasks?scheduled=true'));
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].title).toBe('Renew the domain');
    expect(body.tasks[0].schedule.next_at).toBe('2026-09-11T09:00:00.000Z');
  });
});

describe('TaskService.update', () => {
  it('changes only the fields it is given', async () => {
    const [task] = await seed([{ title: 'Ship it', description: 'keep me', priority: 'low' }]);
    const updated = await service().update(task!.id, { status: 'done' });

    expect(updated.status).toBe('done');
    expect(updated.description).toBe('keep me');
    expect(updated.priority).toBe('low');
    expect(updated.updated_at > task!.updated_at).toBe(true);
  });

  it('clears a field when given null', async () => {
    const [task] = await seed([{ title: 'Ship it', description: 'drop me', due_date: '2026-09-09' }]);
    const updated = await service().update(task!.id, { description: null, due_date: null });

    expect(updated.description).toBeNull();
    expect(updated.due_date).toBeNull();
  });

  it('refuses an update with no fields, which would only bump updated_at', async () => {
    const [task] = await seed([{ title: 'Ship it' }]);
    await expect(service().update(task!.id, {})).rejects.toBeInstanceOf(TaskValidationError);
  });

  it('refuses unknown keys rather than ignoring them', async () => {
    const [task] = await seed([{ title: 'Ship it' }]);
    await expect(
      service().update(task!.id, { id: 'sneaky' } as never),
    ).rejects.toBeInstanceOf(TaskValidationError);
  });

  it('throws TaskNotFoundError for an id that is not there', async () => {
    await expect(service().update(crypto.randomUUID(), { status: 'done' })).rejects.toBeInstanceOf(
      TaskNotFoundError,
    );
  });
});

describe('REST', () => {
  it('creates and reads back a task', async () => {
    const created = await SELF.fetch('https://test/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Renew the domain', priority: 'high' }),
    });
    expect(created.status).toBe(201);
    const { task } = await json(created);

    const fetched = await SELF.fetch(`https://test/api/tasks/${task.id}`);
    expect(fetched.status).toBe(200);
    expect((await json(fetched)).task.title).toBe('Renew the domain');
  });

  it('filters GET /api/tasks by query params', async () => {
    await seed([
      { title: 'Finish Cloudflare assignment', priority: 'high' },
      { title: 'Buy milk', status: 'done' },
    ]);

    const response = await SELF.fetch('https://test/api/tasks?status=todo,in_progress&query=cloudflare');
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.tasks).toHaveLength(1);
    expect(body.truncated).toBe(false);
  });

  it('rejects a malformed filter with 400', async () => {
    const response = await SELF.fetch('https://test/api/tasks?status=archived');
    expect(response.status).toBe(400);
    expect((await json(response)).issues).toBeDefined();
  });

  it('patches a task and reports 404 for an unknown one', async () => {
    const [task] = await seed([{ title: 'Ship it' }]);

    const patched = await SELF.fetch(`https://test/api/tasks/${task!.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done', priority: 'high' }),
    });
    expect(patched.status).toBe(200);
    expect((await json(patched)).task.status).toBe('done');

    const missing = await SELF.fetch(`https://test/api/tasks/${crypto.randomUUID()}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(missing.status).toBe(404);
  });

  it('rejects an empty patch body with 400', async () => {
    const [task] = await seed([{ title: 'Ship it' }]);
    const response = await SELF.fetch(`https://test/api/tasks/${task!.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(400);
  });
});
