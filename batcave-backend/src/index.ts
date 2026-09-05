import { Hono, type ErrorHandler } from 'hono';
import { findInfrastructureError } from './agent/middleware/escalate';
import { classifyModelError } from './agent/modelErrors';
import { ERRORS } from './errors';
import { chatsRoute } from './routes/chat';
import { tasksRoute } from './routes/tasks';
import { ChatBusyError, ChatNotFoundError, ChatValidationError } from './services/chatService';
import { TaskNotFoundError, TaskValidationError } from './services/taskService';
import type { Env } from './types/task';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/api/tasks', tasksRoute);
app.route('/api/chats', chatsRoute);

app.notFound((c) => c.json({ error: ERRORS.NOT_FOUND }, 404));

/**
 * Two audiences. A caller who sent something wrong gets 400 or 404 and can fix
 * it; everything else is ours to fix and is logged. The agent's failures are
 * unwrapped from whatever the graph added on the way out, so a D1 outage inside
 * a tool surfaces as 503 rather than a generic 500 or, worse, a 200.
 */
export const onError: ErrorHandler<{ Bindings: Env }> = (error, c) => {
  if (error instanceof TaskValidationError) {
    return c.json({ error: error.message, issues: error.issues }, 400);
  }
  if (error instanceof TaskNotFoundError) {
    return c.json({ error: error.message }, 404);
  }
  if (error instanceof ChatValidationError) {
    return c.json({ error: error.message, issues: error.issues }, 400);
  }
  if (error instanceof ChatNotFoundError) {
    return c.json({ error: error.message }, 404);
  }
  if (error instanceof ChatBusyError) {
    return c.json({ error: error.message }, 409);
  }

  const infrastructure = findInfrastructureError(error);
  if (infrastructure) {
    console.error(`Tool "${infrastructure.tool}" failed:`, infrastructure.cause);
    return c.json({ error: ERRORS.AGENT_UNAVAILABLE }, 503);
  }

  const model = classifyModelError(error);
  if (model) {
    console.error('Model call failed:', error);
    return c.json({ error: model.message }, model.status);
  }

  console.error('Unhandled error:', error);
  return c.json({ error: ERRORS.INTERNAL_SERVER_ERROR }, 500);
};

app.onError(onError);

export default app;
