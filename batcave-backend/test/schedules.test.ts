import { env, introspectWorkflowInstance } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertTask } from '../src/db/tasks';
import { ERRORS } from '../src/errors';
import { MIN_NOTIFICATION_GAP_MS } from '../src/lib/cron';
import {
  MAX_NOTIFICATIONS,
  NotificationNotFoundError,
  ScheduleNotFoundError,
  ScheduleService,
  ScheduleValidationError,
  notificationId,
} from '../src/services/scheduleService';
import { TaskNotFoundError, TaskService } from '../src/services/taskService';
import type { Notification, Schedule } from '../src/types/schedule';
import type { Task } from '../src/types/task';
import { OWNER, api } from './helpers/auth';
import { resetDb } from './helpers/reset';
import { fakeWorkflow } from './helpers/workflow';

beforeEach(resetDb);

/** Fixed so a cron's next occurrence is a value the test can name. */
const NOW = new Date('2026-09-06T12:00:00.000Z');
const IN_AN_HOUR = '2026-09-06T13:00:00.000Z';

/**
 * The stub binding by default: these cases are about what the rows say, and a
 * real instance would sleep for an hour and then have to be torn down when the
 * next test empties the tables. The workflow's own behaviour has its own block
 * below, against the real binding.
 */
const service = (now: Date = NOW, workflow = fakeWorkflow()) =>
  new ScheduleService(env.DB, workflow, OWNER, () => now);

const seed = (row: Partial<Task> & { title: string }) =>
  insertTask(env.DB, {
    id: crypto.randomUUID(),
    user_id: OWNER,
    description: null,
    status: 'todo',
    priority: 'medium',
    due_date: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...row,
  });

const readSchedule = (id: string) =>
  env.DB.prepare('SELECT * FROM schedules WHERE id = ?').bind(id).first<Schedule>();

const readNotifications = async (scheduleId: string) => {
  const { results } = await env.DB.prepare(
    'SELECT * FROM notifications WHERE schedule_id = ? ORDER BY seq',
  )
    .bind(scheduleId)
    .all<Notification>();
  return results;
};

const json = async (response: Response) => (await response.json()) as Record<string, any>;

describe('scheduling once', () => {
  it('stores the instant and starts an instance under the schedule id', async () => {
    const task = await seed({ title: 'Renew the domain' });
    const workflow = fakeWorkflow();
    const { schedule, replaced } = await service(NOW, workflow).scheduleOnce(task.id, {
      remind_at: IN_AN_HOUR,
    });

    expect(schedule).toMatchObject({
      task_id: task.id,
      kind: 'once',
      cron: null,
      next_at: IN_AN_HOUR,
      status: 'active',
      notification_count: 0,
    });
    expect(replaced).toBeNull();

    // The instance id is the schedule id, which is what lets a row and its
    // clock be found from each other with no extra column.
    expect(workflow.created).toEqual([schedule.id]);
  });

  it('fails the turn when the clock could not be started', async () => {
    const task = await seed({ title: 'Renew the domain' });

    // Rethrown rather than swallowed: a schedule with no instance would look
    // scheduled and never fire, so the tool escalates and the turn is a 503.
    await expect(
      service(NOW, fakeWorkflow({ createFails: true })).scheduleOnce(task.id, {
        remind_at: IN_AN_HOUR,
      }),
    ).rejects.toThrow('WORKFLOW_UNAVAILABLE');
  });

  it('accepts a create that failed only because the instance already exists', async () => {
    const task = await seed({ title: 'Renew the domain' });
    const workflow = fakeWorkflow({ createFails: true, exists: true });

    const { schedule } = await service(NOW, workflow).scheduleOnce(task.id, {
      remind_at: IN_AN_HOUR,
    });
    expect(schedule.status).toBe('active');
  });

  it('normalises an offset time to UTC', async () => {
    const task = await seed({ title: 'Call the bank' });
    const { schedule } = await service().scheduleOnce(task.id, {
      remind_at: '2026-09-06T18:30:00+05:30',
    });

    expect(schedule.next_at).toBe('2026-09-06T13:00:00.000Z');
  });

  it('refuses a time that has passed', async () => {
    const task = await seed({ title: 'Renew the domain' });
    await expect(
      service().scheduleOnce(task.id, { remind_at: '2026-09-06T11:59:00.000Z' }),
    ).rejects.toMatchObject({ message: ERRORS.SCHEDULE_IN_PAST });
  });

  it('refuses a time more than a year out', async () => {
    const task = await seed({ title: 'Renew the domain' });
    await expect(
      service().scheduleOnce(task.id, { remind_at: '2028-01-01T09:00:00.000Z' }),
    ).rejects.toMatchObject({ message: ERRORS.SCHEDULE_TOO_FAR });
  });

  it('refuses a date with no time on it', async () => {
    const task = await seed({ title: 'Renew the domain' });
    await expect(
      service().scheduleOnce(task.id, { remind_at: '2026-09-11' }),
    ).rejects.toBeInstanceOf(ScheduleValidationError);
  });

  it('refuses a finished task, which has nothing left to remind about', async () => {
    const task = await seed({ title: 'Renew the domain', status: 'done' });
    await expect(
      service().scheduleOnce(task.id, { remind_at: IN_AN_HOUR }),
    ).rejects.toMatchObject({ message: ERRORS.SCHEDULE_TASK_DONE });
  });

  it('refuses a task that does not exist', async () => {
    await expect(
      service().scheduleOnce(crypto.randomUUID(), { remind_at: IN_AN_HOUR }),
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });
});

describe('scheduling recurring', () => {
  it('stores the cron and resolves the first occurrence', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { schedule } = await service().scheduleRecurring(task.id, { cron: '0 9 * * 1' });

    expect(schedule).toMatchObject({
      kind: 'recurring',
      cron: '0 9 * * 1',
      next_at: '2026-09-07T09:00:00.000Z',
      status: 'active',
    });
  });

  it('is allowed on a finished task, because the first firing reopens it', async () => {
    const task = await seed({ title: 'Water the plants', status: 'done' });
    const { schedule } = await service().scheduleRecurring(task.id, { cron: '0 9 * * 1' });
    expect(schedule.status).toBe('active');
  });

  it('passes the cron failure through, so the model can correct it', async () => {
    const task = await seed({ title: 'Water the plants' });

    await expect(
      service().scheduleRecurring(task.id, { cron: '0 99 * * *' }),
    ).rejects.toMatchObject({ message: ERRORS.SCHEDULE_CRON_INVALID });

    await expect(
      service().scheduleRecurring(task.id, { cron: '*/5 * * * *' }),
    ).rejects.toMatchObject({ message: ERRORS.SCHEDULE_CRON_TOO_FREQUENT });

    // Six fields is croner's own extension, and not what the prompt teaches.
    await expect(
      service().scheduleRecurring(task.id, { cron: '0 0 9 * * 1' }),
    ).rejects.toBeInstanceOf(ScheduleValidationError);
  });
});

describe('one schedule per task', () => {
  it('replaces the previous one and reports what it replaced', async () => {
    const task = await seed({ title: 'Water the plants' });
    const workflow = fakeWorkflow();
    const first = await service(NOW, workflow).scheduleOnce(task.id, { remind_at: IN_AN_HOUR });
    const second = await service(NOW, workflow).scheduleRecurring(task.id, { cron: '0 9 * * 1' });

    expect(second.replaced?.id).toBe(first.schedule.id);
    // The replaced instance is stopped, so it does not wake on a dead row.
    expect(workflow.terminated).toEqual([first.schedule.id]);
    expect((await readSchedule(first.schedule.id))?.status).toBe('cancelled');
    expect((await readSchedule(second.schedule.id))?.status).toBe('active');
  });

  it('leaves other tasks alone', async () => {
    const [one, two] = [await seed({ title: 'One' }), await seed({ title: 'Two' })];
    const kept = await service().scheduleOnce(one.id, { remind_at: IN_AN_HOUR });
    await service().scheduleOnce(two.id, { remind_at: IN_AN_HOUR });

    expect((await readSchedule(kept.schedule.id))?.status).toBe('active');
  });

  it('treats a retried tool call as the same schedule, not a replacement', async () => {
    const task = await seed({ title: 'Water the plants' });
    const id = crypto.randomUUID();

    const workflow = fakeWorkflow();
    const first = await service(NOW, workflow).scheduleOnce(
      task.id,
      { remind_at: IN_AN_HOUR },
      { id },
    );
    const retry = await service(NOW, workflow).scheduleOnce(
      task.id,
      { remind_at: '2026-09-06T14:00:00.000Z' },
      { id },
    );

    // The retry returns the row the first attempt wrote — a second instant
    // would mean the model's retry silently moved the reminder.
    expect(retry.schedule).toEqual(first.schedule);
    expect(retry.replaced).toBeNull();

    const { results } = await env.DB.prepare('SELECT id FROM schedules').all();
    expect(results).toHaveLength(1);
  });
});

describe('cancelling', () => {
  it('cancels by task and keeps the row', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { schedule } = await service().scheduleOnce(task.id, { remind_at: IN_AN_HOUR });

    const cancelled = await service().cancelForTask(task.id);
    expect(cancelled).toMatchObject({ id: schedule.id, status: 'cancelled' });
    expect((await readSchedule(schedule.id))?.ended_at).toBe(NOW.toISOString());
  });

  it('reports a task with nothing scheduled', async () => {
    const task = await seed({ title: 'Water the plants' });
    await expect(service().cancelForTask(task.id)).rejects.toBeInstanceOf(ScheduleNotFoundError);
  });

  it('will not cancel the same schedule twice', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { schedule } = await service().scheduleOnce(task.id, { remind_at: IN_AN_HOUR });

    await service().cancel(schedule.id);
    await expect(service().cancel(schedule.id)).rejects.toBeInstanceOf(ScheduleNotFoundError);
  });
});

describe('a firing', () => {
  it('notifies for a one-shot and ends the schedule', async () => {
    const task = await seed({ title: 'Renew the domain' });
    const { schedule } = await service().scheduleOnce(task.id, { remind_at: IN_AN_HOUR });

    const result = await service().notify(schedule.id, 1);
    expect(result).toEqual({ stop: true, outcome: 'notified' });

    const [notification] = await readNotifications(schedule.id);
    expect(notification).toMatchObject({
      seq: 1,
      outcome: 'notified',
      reopened: 0,
      acknowledged_at: null,
    });
    expect(await readSchedule(schedule.id)).toMatchObject({
      status: 'ended',
      notification_count: 1,
      ended_at: NOW.toISOString(),
    });
    // A one-shot never touches the task.
    expect((await new TaskService(env.DB, OWNER).getById(task.id))?.status).toBe('todo');
  });

  it('records a one-shot whose task was finished as skipped', async () => {
    const task = await seed({ title: 'Renew the domain' });
    const { schedule } = await service().scheduleOnce(task.id, { remind_at: IN_AN_HOUR });
    await new TaskService(env.DB, OWNER).update(task.id, { status: 'done' });

    expect(await service().notify(schedule.id, 1)).toEqual({ stop: true, outcome: 'skipped' });
    expect((await readNotifications(schedule.id))[0]?.outcome).toBe('skipped');
  });

  it('advances a recurring schedule to its next occurrence', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { schedule } = await service().scheduleRecurring(task.id, { cron: '0 9 * * 1' });

    // Woken at the first occurrence, so the next is a week later.
    const at = new Date('2026-09-07T09:00:00.000Z');
    expect(await service(at).notify(schedule.id, 1)).toEqual({ stop: false, outcome: 'notified' });

    expect(await readSchedule(schedule.id)).toMatchObject({
      status: 'active',
      notification_count: 1,
      next_at: '2026-09-14T09:00:00.000Z',
    });
  });

  it('reopens a finished task and says that it did', async () => {
    const task = await seed({ title: 'Water the plants', status: 'done' });
    const { schedule } = await service().scheduleRecurring(task.id, { cron: '0 9 * * 1' });

    await service(new Date('2026-09-07T09:00:00.000Z')).notify(schedule.id, 1);

    expect((await new TaskService(env.DB, OWNER).getById(task.id))?.status).toBe('todo');
    expect((await readNotifications(schedule.id))[0]).toMatchObject({
      outcome: 'notified',
      reopened: 1,
    });
  });

  it('skips the occurrences an instance slept through instead of firing a burst', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { schedule } = await service().scheduleRecurring(task.id, { cron: '0 9 * * 1' });

    // Three weeks late: the next occurrence is computed from now, not from the
    // one that was missed.
    await service(new Date('2026-09-28T10:00:00.000Z')).notify(schedule.id, 1);

    expect((await readSchedule(schedule.id))?.next_at).toBe('2026-10-05T09:00:00.000Z');
    expect(await readNotifications(schedule.id)).toHaveLength(1);
  });

  it('is a no-op when the same firing runs twice', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { schedule } = await service().scheduleRecurring(task.id, { cron: '0 9 * * 1' });

    const at = new Date('2026-09-07T09:00:00.000Z');
    await service(at).notify(schedule.id, 1);
    await service(at).notify(schedule.id, 1);

    // The derived id upserts, and the count guard refuses the second advance.
    expect(await readNotifications(schedule.id)).toHaveLength(1);
    expect(await readSchedule(schedule.id)).toMatchObject({
      notification_count: 1,
      next_at: '2026-09-14T09:00:00.000Z',
    });
  });

  it('stops on a schedule that was cancelled while its instance slept', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { schedule } = await service().scheduleRecurring(task.id, { cron: '0 9 * * 1' });
    await service().cancel(schedule.id);

    expect(await service().notify(schedule.id, 1)).toEqual({ stop: true, outcome: 'ignored' });
    expect(await readNotifications(schedule.id)).toHaveLength(0);
  });

  it('ends a recurring schedule that has fired enough times', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { schedule } = await service().scheduleRecurring(task.id, { cron: '0 9 * * 1' });

    await env.DB.prepare('UPDATE schedules SET notification_count = ? WHERE id = ?')
      .bind(MAX_NOTIFICATIONS - 1, schedule.id)
      .run();

    const at = new Date('2026-09-07T09:00:00.000Z');
    expect(await service(at).notify(schedule.id, MAX_NOTIFICATIONS)).toEqual({
      stop: true,
      outcome: 'notified',
    });
    expect((await readSchedule(schedule.id))?.status).toBe('ended');
  });

  it('ends a recurring schedule once its next run is past the horizon', async () => {
    const task = await seed({ title: 'File the annual return' });
    // Every 1 January: from September 2026 the second occurrence is in 2028,
    // more than a year after the schedule was created.
    const { schedule } = await service().scheduleRecurring(task.id, { cron: '0 9 1 1 *' });

    const at = new Date('2027-01-01T09:00:00.000Z');
    expect(await service(at).notify(schedule.id, 1)).toEqual({ stop: true, outcome: 'notified' });
    expect((await readSchedule(schedule.id))?.status).toBe('ended');
  });
});

describe('plan', () => {
  it('hands the workflow the next instant while the schedule is active', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { schedule } = await service().scheduleOnce(task.id, { remind_at: IN_AN_HOUR });

    expect(await service().plan(schedule.id)).toEqual({ stop: false, nextAt: IN_AN_HOUR });
  });

  it('stops on anything that is not active, including a row that is gone', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { schedule } = await service().scheduleOnce(task.id, { remind_at: IN_AN_HOUR });
    await service().cancel(schedule.id);

    expect(await service().plan(schedule.id)).toEqual({ stop: true });
    expect(await service().plan(crypto.randomUUID())).toEqual({ stop: true });
  });
});

describe('the workflow', () => {
  it('sleeps, fires once, and completes', async () => {
    const task = await seed({ title: 'Renew the domain' });
    const id = crypto.randomUUID();

    await using instance = await introspectWorkflowInstance(env.TASK_SCHEDULE, id);
    await instance.modify(async (m) => {
      await m.disableSleeps();
    });

    const { schedule } = await new ScheduleService(env.DB, env.TASK_SCHEDULE, OWNER).scheduleOnce(
      task.id,
      { remind_at: new Date(Date.now() + 3_600_000).toISOString() },
      { id },
    );

    await instance.waitForStatus('complete');
    expect(await instance.getOutput()).toEqual({ notifications: 1 });

    expect((await readNotifications(schedule.id))[0]).toMatchObject({
      seq: 1,
      outcome: 'notified',
    });
    expect((await readSchedule(schedule.id))?.status).toBe('ended');
  });

  it('keeps going after a recurring firing, and stops when the row is cancelled', async () => {
    const task = await seed({ title: 'Water the plants', status: 'done' });
    const id = crypto.randomUUID();

    await using instance = await introspectWorkflowInstance(env.TASK_SCHEDULE, id);
    // Only the first sleep: disabling every sleep would spin to the cap.
    await instance.modify(async (m) => {
      await m.disableSleeps([{ name: 'sleep #1' }]);
    });

    const schedules = new ScheduleService(env.DB, env.TASK_SCHEDULE, OWNER);
    const { schedule } = await schedules.scheduleRecurring(task.id, { cron: '0 9 * * 1' }, { id });

    expect(await instance.waitForStepResult({ name: 'notify #1' })).toMatchObject({ stop: false });

    // It fired, reopened the task, and armed the next occurrence.
    expect((await readNotifications(schedule.id))[0]).toMatchObject({ reopened: 1 });
    expect((await new TaskService(env.DB, OWNER).getById(task.id))?.status).toBe('todo');
    expect(await readSchedule(schedule.id)).toMatchObject({
      status: 'active',
      notification_count: 1,
    });

    await schedules.cancel(schedule.id);
    await instance.waitForStatus('terminated');
  });
});

describe('the REST surface', () => {
  it('lists schedules with their task, newest occurrence first', async () => {
    const [soon, later] = [await seed({ title: 'Soon' }), await seed({ title: 'Later' })];
    await service().scheduleOnce(later.id, { remind_at: '2026-09-08T09:00:00.000Z' });
    await service().scheduleOnce(soon.id, { remind_at: IN_AN_HOUR });

    const body = await json(await api('/api/schedules'));
    expect(body.schedules.map((row: any) => row.task.title)).toEqual(['Soon', 'Later']);
    expect(body.truncated).toBe(false);
  });

  it('filters by status', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { schedule } = await service().scheduleOnce(task.id, { remind_at: IN_AN_HOUR });
    await service().cancel(schedule.id);

    const active = await json(await api('/api/schedules?status=active'));
    expect(active.schedules).toHaveLength(0);

    const cancelled = await json(await api('/api/schedules?status=cancelled'));
    expect(cancelled.schedules).toHaveLength(1);
  });

  it('rejects a status that is not one', async () => {
    const response = await api('/api/schedules?status=pending');
    expect(response.status).toBe(400);
    expect((await json(response)).error).toBe(ERRORS.INVALID_SCHEDULE_LIST);
  });

  it('cancels through DELETE and answers with the row', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { schedule } = await service().scheduleOnce(task.id, { remind_at: IN_AN_HOUR });

    const response = await api(`/api/schedules/${schedule.id}`, {
      method: 'DELETE',
    });
    expect(response.status).toBe(200);
    expect((await json(response)).schedule.status).toBe('cancelled');

    const second = await api(`/api/schedules/${schedule.id}`, { method: 'DELETE' });
    expect(second.status).toBe(404);
  });

  it('lists notifications unacknowledged first and acknowledges one', async () => {
    const task = await seed({ title: 'Renew the domain' });
    const { schedule } = await service().scheduleOnce(task.id, { remind_at: IN_AN_HOUR });
    await service().notify(schedule.id, 1);
    const id = await notificationId(schedule.id, 1);

    const unread = await json(await api('/api/notifications?acknowledged=false'));
    expect(unread.notifications).toHaveLength(1);
    expect(unread.notifications[0].task.title).toBe('Renew the domain');

    const response = await api(`/api/notifications/${id}/acknowledge`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect((await json(response)).notification.acknowledged_at).toBeTruthy();

    const stillUnread = await json(
      await api('/api/notifications?acknowledged=false'),
    );
    expect(stillUnread.notifications).toHaveLength(0);
  });

  it('will not acknowledge the same notification twice', async () => {
    const task = await seed({ title: 'Renew the domain' });
    const { schedule } = await service().scheduleOnce(task.id, { remind_at: IN_AN_HOUR });
    await service().notify(schedule.id, 1);
    const id = await notificationId(schedule.id, 1);

    await service().acknowledge(id);
    await expect(service().acknowledge(id)).rejects.toBeInstanceOf(NotificationNotFoundError);

    const response = await api(`/api/notifications/${id}/acknowledge`, {
      method: 'POST',
    });
    expect(response.status).toBe(404);
  });

  it('rejects a notification id that is not a uuid', async () => {
    const response = await api('/api/notifications/nope/acknowledge', {
      method: 'POST',
    });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toBe(ERRORS.NOTIFICATION_ID_INVALID);
  });
});

describe('deleting a task', () => {
  it('takes its schedule and notifications with it', async () => {
    const task = await seed({ title: 'Water the plants' });
    const { schedule } = await service().scheduleOnce(task.id, { remind_at: IN_AN_HOUR });
    await service().notify(schedule.id, 1);

    await env.DB.prepare('PRAGMA foreign_keys = ON').run();
    await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(task.id).run();

    expect(await readSchedule(schedule.id)).toBeNull();
    expect(await readNotifications(schedule.id)).toHaveLength(0);
  });
});

describe('the frequency floor', () => {
  it('is the same number the cron module enforces', () => {
    expect(MIN_NOTIFICATION_GAP_MS).toBe(900_000);
  });
});
