import { tool } from 'langchain';
import { cancelScheduleToolSchema } from '../../schemas/schedule';
import type { ScheduleService } from '../../services/scheduleService';
import type { TaskService } from '../../services/taskService';
import { envelope } from './envelope';
import { scheduleResult } from './scheduleResult';
import { CANCEL_SCHEDULE } from './names';

export const cancelScheduleTool = (schedules: ScheduleService, tasks: TaskService) =>
  tool(
    async ({ id }) =>
      envelope(async () =>
        scheduleResult(tasks, id, { schedule: await schedules.cancelForTask(id), replaced: null }),
      ),
    {
      name: CANCEL_SCHEDULE,
      description:
        'Stop the reminder or recurring schedule on a task, so it stops notifying the user. The task itself is untouched and notifications it already sent stay in the user\'s list. A task with no active schedule comes back as an ordinary `ok: false` — say so rather than retrying. To move a schedule rather than remove it, call schedule_reminder or schedule_recurring again; they replace in place, so cancelling first is unnecessary.',
      schema: cancelScheduleToolSchema,
    },
  );
