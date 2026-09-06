import type { ScheduleService } from '../../services/scheduleService';
import type { TaskService } from '../../services/taskService';
import { cancelScheduleTool } from './cancelSchedule';
import { createTaskTool } from './createTask';
import { scheduleRecurringTool } from './scheduleRecurring';
import { scheduleReminderTool } from './scheduleReminder';
import { searchTasksTool } from './searchTasks';
import { updateTaskTool } from './updateTask';

export interface ToolServices {
  tasks: TaskService;
  schedules: ScheduleService;
}

/**
 * Tools are built per request in a factory closing over the services, so nothing
 * about the agent is module-level state that could leak between requests in a
 * reused isolate.
 */
export const buildTools = ({ tasks, schedules }: ToolServices) => [
  createTaskTool(tasks),
  searchTasksTool(tasks),
  updateTaskTool(tasks),
  scheduleReminderTool(schedules, tasks),
  scheduleRecurringTool(schedules, tasks),
  cancelScheduleTool(schedules, tasks),
];

export {
  CANCEL_SCHEDULE,
  CREATE_TASK,
  SCHEDULE_RECURRING,
  SCHEDULE_REMINDER,
  SEARCH_TASKS,
  UPDATE_TASK,
} from './names';
