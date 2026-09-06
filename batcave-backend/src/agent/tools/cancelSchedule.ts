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
        'Stop a task\'s reminder or recurring schedule. `id` must come from a search_tasks or create_task result in this conversation. Fails if the task has no active schedule. Past notifications stay in the user\'s list.',
      schema: cancelScheduleToolSchema,
    },
  );
