import { Hono } from 'hono';
import { GroqError } from './agent/agent';
import { ERRORS } from './errors';
import { chatRoute } from './routes/chat';
import { tasksRoute } from './routes/tasks';
import { TaskValidationError } from './services/taskService';
import type { Env } from './types/task';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/api/tasks', tasksRoute);
app.route('/api/chat', chatRoute);

app.notFound((c) => c.json({ error: ERRORS.NOT_FOUND }, 404));

app.onError((error, c) => {
  if (error instanceof TaskValidationError) {
    return c.json({ error: error.message, issues: error.issues }, 400);
  }
  if (error instanceof GroqError) {
    return c.json({ error: error.message }, 502);
  }

  console.error('Unhandled error:', error);
  return c.json({ error: ERRORS.INTERNAL_SERVER_ERROR }, 500);
});

export default app;
