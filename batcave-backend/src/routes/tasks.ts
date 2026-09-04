import { Hono } from 'hono';
import { ERRORS } from '../errors';
import { createTaskSchema } from '../schemas/task';
import { TaskService } from '../services/taskService';
import type { Env } from '../types/task';

export const tasksRoute = new Hono<{ Bindings: Env }>();

tasksRoute.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: ERRORS.INVALID_JSON_BODY }, 400);
  }

  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: ERRORS.INVALID_TASK_INPUT, issues: parsed.error.issues }, 400);
  }

  const service = new TaskService(c.env.DB);
  const task = await service.create(parsed.data);

  return c.json({ task }, 201);
});

tasksRoute.get('/', async (c) => {
  const service = new TaskService(c.env.DB);
  const tasks = await service.getAll();
  
  return c.json({ tasks });
});

tasksRoute.get('/:id', async (c) => {
  const { id } = c.req.param();
  const service = new TaskService(c.env.DB);
  const task = await service.getById(id);

  if (!task) {
    return c.json({ error: ERRORS.TASK_NOT_FOUND }, 404);
  }

  return c.json({ task });
});