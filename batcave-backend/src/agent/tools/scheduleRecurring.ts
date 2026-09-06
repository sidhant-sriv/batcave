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
        'Notify the user about a task on a repeating schedule, until they cancel it. `cron` is a five-field expression evaluated in UTC: "0 9 * * 1" is every Monday at 09:00, "0 18 * * *" every day at 18:00, "0 9 1 * *" the first of each month. It must not fire more often than every 15 minutes. `id` must come from a search_tasks or create_task result in this conversation. A task has one schedule: this replaces any existing one. Each notification puts the task back to todo if it was done, so it works as a recurring chore.',
      schema: scheduleRecurringToolSchema,
    },
  );
