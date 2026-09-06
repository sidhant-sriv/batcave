import { tool, type ToolRuntime } from 'langchain';
import { scheduleReminderToolSchema } from '../../schemas/schedule';
import type { ScheduleService } from '../../services/scheduleService';
import type { TaskService } from '../../services/taskService';
import { scheduleId } from '../scheduleId';
import { envelope } from './envelope';
import { scheduleResult } from './scheduleResult';
import { SCHEDULE_REMINDER } from './names';

export const scheduleReminderTool = (schedules: ScheduleService, tasks: TaskService) =>
  tool(
    async ({ id, remind_at }, runtime: ToolRuntime) =>
      envelope(async () =>
        scheduleResult(
          tasks,
          id,
          await schedules.scheduleOnce(id, { remind_at }, { id: await scheduleId(runtime.toolCallId) }),
        ),
      ),
    {
      name: SCHEDULE_REMINDER,
      description:
        'Remind the user about a task once, at an absolute time. `remind_at` is an ISO 8601 UTC instant such as 2026-09-11T09:00:00Z and must be in the future — resolve "Friday morning" or "in two hours" against the current time yourself. `id` must come from a search_tasks or create_task result in this conversation. A task has one schedule: this replaces any existing one. It notifies the user and never changes the task.',
      schema: scheduleReminderToolSchema,
    },
  );
