import { Hono } from 'hono';
import { ERRORS } from '../errors';
import { listNotificationsSchema } from '../schemas/schedule';
import { ScheduleService } from '../services/scheduleService';
import type { Env } from '../types/task';

/**
 * The inbox: every time a schedule fired. Written only by the Workflow, read
 * and acknowledged here.
 */
export const notificationsRoute = new Hono<{ Bindings: Env }>();

const service = (env: Env) => new ScheduleService(env.DB, env.TASK_SCHEDULE);

notificationsRoute.get('/', async (c) => {
  const acknowledged = c.req.query('acknowledged');
  const limit = c.req.query('limit');

  const parsed = listNotificationsSchema.safeParse({
    ...(acknowledged === undefined ? {} : { acknowledged }),
    ...(limit === undefined ? {} : { limit }),
  });
  if (!parsed.success) {
    return c.json({ error: ERRORS.INVALID_NOTIFICATION_LIST, issues: parsed.error.issues }, 400);
  }

  const { notifications, truncated } = await service(c.env).listNotifications(parsed.data);
  return c.json({ notifications, truncated });
});

/**
 * The user has seen it. Deliberately an explicit action rather than a timer:
 * a notification that expired on its own would be indistinguishable from one
 * nobody was there to read.
 */
notificationsRoute.post('/:id/acknowledge', async (c) => {
  const notification = await service(c.env).acknowledge(c.req.param('id'));
  return c.json({ notification });
});
