import { Hono } from 'hono';
import { createTaskSchema } from '../schemas/task';
import { TaskService } from '../services/taskService';
import type { Env } from '../types/task';

export const tasksRoute = new Hono<{ Bindings: Env }>();

tasksRoute.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Request body must be valid JSON' }, 400);
  }

  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid task input', issues: parsed.error.issues }, 400);
  }

  const service = new TaskService(c.env.DB);
  const task = await service.create(parsed.data);

  return c.json({ task }, 201);
});
