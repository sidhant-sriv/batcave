import { tool, type ToolRuntime } from 'langchain';
import { scheduleRecurringToolSchema } from '../../schemas/schedule';
import type { ScheduleService } from '../../services/scheduleService';
import type { TaskService } from '../../services/taskService';
import { scheduleId } from '../scheduleId';
import { envelope } from './envelope';
import { scheduleResult } from './scheduleResult';
import { SCHEDULE_RECURRING } from './names';

export const scheduleRecurringTool = (schedules: ScheduleService, tasks: TaskService) =>
  tool(
    async ({ id, cron }, runtime: ToolRuntime) =>
      envelope(async () =>
        scheduleResult(
          tasks,
          id,
          await schedules.scheduleRecurring(id, { cron }, { id: await scheduleId(runtime.toolCallId) }),
        ),
      ),
    {
      name: SCHEDULE_RECURRING,
      description:
        'Notify the user about a task over and over on a cron schedule, for "every Monday" or "daily at 6pm", until they cancel it. Unlike a one-off reminder this does change the task: every notification puts it back to todo if it was done, which is what makes it a recurring chore rather than a nag. A task has at most one schedule, so this replaces whatever it had — the result reports the new schedule and, in `replaced`, the one it superseded, which is worth telling the user about.',
      schema: scheduleRecurringToolSchema,
    },
  );
