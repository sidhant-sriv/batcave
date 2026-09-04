import { Hono } from 'hono';
import { z } from 'zod';
import { runAgent } from '../agent/agent';
import { TaskService } from '../services/taskService';
import type { Env } from '../types/task';

const chatSchema = z.object({
  message: z.string().trim().min(1, 'message is required').max(2000),
});

export const chatRoute = new Hono<{ Bindings: Env }>();

chatRoute.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Request body must be valid JSON' }, 400);
  }

  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid chat input', issues: parsed.error.issues }, 400);
  }

  if (!c.env.GROQ_API_KEY) {
    return c.json({ error: 'GROQ_API_KEY is not configured' }, 500);
  }

  const service = new TaskService(c.env.DB);
  const result = await runAgent(parsed.data.message, service, c.env);

  return c.json(result, result.task ? 201 : 200);
});
