import { Hono } from 'hono';
import { ERRORS } from '../errors';
import { createTaskSchema, searchTasksSchema, updateTaskSchema } from '../schemas/task';
import { TaskService } from '../services/taskService';
import type { AppEnv } from '../types/task';
import { parseSearchQuery } from './searchParams';

export const tasksRoute = new Hono<AppEnv>();

async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<
  { ok: true; body: unknown } | { ok: false }
> {
  try {
    return { ok: true, body: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

tasksRoute.post('/', async (c) => {
  const body = await jsonBody(c);
  if (!body.ok) {
    return c.json({ error: ERRORS.INVALID_JSON_BODY }, 400);
  }

  const parsed = createTaskSchema.safeParse(body.body);
  if (!parsed.success) {
    return c.json({ error: ERRORS.INVALID_TASK_INPUT, issues: parsed.error.issues }, 400);
  }

  const service = new TaskService(c.env.DB, c.get('user').login);
  const task = await service.create(parsed.data);

  return c.json({ task }, 201);
});

tasksRoute.get('/', async (c) => {
  const parsed = searchTasksSchema.safeParse(parseSearchQuery(c.req.queries()));
  if (!parsed.success) {
    return c.json({ error: ERRORS.INVALID_SEARCH_FILTERS, issues: parsed.error.issues }, 400);
  }

  const service = new TaskService(c.env.DB, c.get('user').login);
  const { tasks, truncated } = await service.search(parsed.data);

  return c.json({ tasks, truncated });
});

tasksRoute.get('/:id', async (c) => {
  const { id } = c.req.param();
  const service = new TaskService(c.env.DB, c.get('user').login);
  const task = await service.getById(id);

  if (!task) {
    return c.json({ error: ERRORS.TASK_NOT_FOUND }, 404);
  }

  return c.json({ task });
});

tasksRoute.patch('/:id', async (c) => {
  const body = await jsonBody(c);
  if (!body.ok) {
    return c.json({ error: ERRORS.INVALID_JSON_BODY }, 400);
  }

  const parsed = updateTaskSchema.safeParse(body.body);
  if (!parsed.success) {
    return c.json({ error: ERRORS.INVALID_TASK_INPUT, issues: parsed.error.issues }, 400);
  }

  // TaskNotFoundError and an invalid id both surface through onError.
  const service = new TaskService(c.env.DB, c.get('user').login);
  const task = await service.update(c.req.param('id'), parsed.data);

  return c.json({ task });
});
