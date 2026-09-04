import { Hono } from 'hono';
import { z } from 'zod';
import { runAgent } from '../agent/agent';
import { ERRORS } from '../errors';
import { TaskService } from '../services/taskService';
import type { Env } from '../types/task';

const chatSchema = z.object({
  message: z.string().trim().min(1, ERRORS.CHAT_MESSAGE_REQUIRED).max(2000),
});

export const chatRoute = new Hono<{ Bindings: Env }>();

chatRoute.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: ERRORS.INVALID_JSON_BODY }, 400);
  }

  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: ERRORS.INVALID_CHAT_INPUT, issues: parsed.error.issues }, 400);
  }

  if (!c.env.GROQ_API_KEY) {
    return c.json({ error: ERRORS.GROQ_API_KEY_MISSING }, 500);
  }

  const service = new TaskService(c.env.DB);
  const result = await runAgent(parsed.data.message, service, c.env);

  return c.json(result, result.task ? 201 : 200);
});
