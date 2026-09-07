import { Hono, type Context } from 'hono';
import { ERRORS } from '../errors';
import { listSchedulesSchema } from '../schemas/schedule';
import { ScheduleService } from '../services/scheduleService';
import type { AppEnv } from '../types/task';

/**
 * The schedules a user has. Read and cancel only: schedules are created by the
 * agent, which is where the language that describes them ("every Monday", "the
 * day before it's due") can be resolved into a cron or an instant.
 */
export const schedulesRoute = new Hono<AppEnv>();

const service = (c: Context<AppEnv>) =>
  new ScheduleService(c.env.DB, c.env.TASK_SCHEDULE, c.get('user').login);

schedulesRoute.get('/', async (c) => {
  const queries = c.req.queries();
  const status = queries.status
    ?.flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  const parsed = listSchedulesSchema.safeParse({
    // An empty or whitespace-only value is a malformed filter rather than "no
    // filter", so the empty array is passed through for `.min(1)` to reject.
    ...(queries.status === undefined ? {} : { status }),
    ...(queries.limit?.[0] === undefined ? {} : { limit: queries.limit[0] }),
  });
  if (!parsed.success) {
    return c.json({ error: ERRORS.INVALID_SCHEDULE_LIST, issues: parsed.error.issues }, 400);
  }

  const { schedules, truncated } = await service(c).listSchedules(parsed.data);
  return c.json({ schedules, truncated });
});

/**
 * Cancels rather than deletes, and answers with the row: the schedule stays
 * visible as cancelled, and the notifications it already produced stay in the
 * user's list. A ScheduleNotFoundError surfaces through onError as 404.
 */
schedulesRoute.delete('/:id', async (c) => {
  const schedule = await service(c).cancel(c.req.param('id'));
  return c.json({ schedule });
});
