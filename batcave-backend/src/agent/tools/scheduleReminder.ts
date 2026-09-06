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
        'Notify the user about a task once, at an absolute time, for "remind me on Friday" or "in two hours". Reminding is not the same as a due date: this changes nothing about the task itself, it only puts a notification in the user\'s scheduled list. A task has at most one schedule, so this replaces whatever it had — the result reports the new schedule and, in `replaced`, the one it superseded, which is worth telling the user about. Use schedule_recurring instead if the reminder should repeat.',
      schema: scheduleReminderToolSchema,
    },
  );
