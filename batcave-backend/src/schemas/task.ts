import { z } from 'zod';
import { ERRORS } from '../errors';
import { TASK_PRIORITIES, TASK_STATUSES } from '../types/task';
import { clearableText, optionalText } from './fields';

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Optional `YYYY-MM-DD` date, the format we store due dates in. */
const dueDate = optionalText(10).refine(
  (value) => value === null || DUE_DATE_PATTERN.test(value),
  ERRORS.TASK_DUE_DATE_FORMAT,
);

const clearableDueDate = clearableText(10).refine(
  (value) => value === undefined || value === null || DUE_DATE_PATTERN.test(value),
  ERRORS.TASK_DUE_DATE_FORMAT,
);

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export const taskIdSchema = z.uuid(ERRORS.TASK_ID_INVALID);

/**
 * Attached to every tool argument that takes a task id. `taskIdGuard` enforces
 * this, so a model that ignores it loses a round rather than writing to the
 * wrong row — but it is cheaper for it to read the rule than to hit the guard.
 */
export const TASK_ID_FROM_RESULT =
  'The id of an existing task, copied verbatim from a search_tasks or create_task ' +
  'result earlier in this conversation. It cannot be guessed or constructed.';

/**
 * The shape TaskService.create() accepts. Both the HTTP route and the agent
 * tool validate against this before anything reaches D1.
 */
export const createTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, ERRORS.TASK_TITLE_REQUIRED)
    .max(200)
    .describe('What the user has to do, in their own words. Required.'),
  description: optionalText(2000).describe(
    'Extra detail the user actually gave. Omit it rather than inventing one.',
  ),
  priority: taskPrioritySchema
    .default('medium')
    .describe('Only when the user signalled urgency. Otherwise leave it at medium.'),
  due_date: dueDate.describe(
    'When the work is due, as an absolute YYYY-MM-DD date. Resolve "Friday" or ' +
      '"tomorrow" against today yourself. This is not a reminder; it notifies nobody.',
  ),
});

export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type CreateTaskData = z.output<typeof createTaskSchema>;

/**
 * Fields a task update may change. Kept as a bare shape so both the REST body
 * schema and the flat tool schema (which adds `id`) can be built from it.
 */
const updateTaskFields = {
  title: z
    .string()
    .trim()
    .min(1, ERRORS.TASK_TITLE_REQUIRED)
    .max(200)
    .optional()
    .describe('A replacement title. Omit unless the user is renaming the task.'),
  description: clearableText(2000).describe(
    'Replacement detail, or null to clear it. Omit to leave it alone.',
  ),
  status: taskStatusSchema
    .optional()
    .describe('Set "done" to complete a task, "in_progress" when work has started.'),
  priority: taskPrioritySchema.optional().describe('Only when the user changed the urgency.'),
  due_date: clearableDueDate.describe(
    'A new due date as an absolute YYYY-MM-DD date, or null to clear it. Omit to ' +
      'leave it alone. Resolve "Friday" or "next week" against today yourself.',
  ),
};

const hasSomeChange = (value: Record<string, unknown>) =>
  Object.entries(value).some(([key, v]) => key !== 'id' && v !== undefined);

/**
 * `strictObject` so an unknown key, or an attempt to smuggle in `id` /
 * `created_at`, is a validation error rather than a silently ignored field.
 */
export const updateTaskSchema = z
  .strictObject(updateTaskFields)
  .refine(hasSomeChange, { message: ERRORS.TASK_UPDATE_EMPTY });

export type UpdateTaskInput = z.input<typeof updateTaskSchema>;
export type UpdateTaskData = z.output<typeof updateTaskSchema>;

/** Flat args for the update_task tool: smaller models emit these reliably. */
export const updateTaskToolSchema = z
  .object({ id: taskIdSchema.describe(TASK_ID_FROM_RESULT), ...updateTaskFields })
  .refine(hasSomeChange, { message: ERRORS.TASK_UPDATE_EMPTY });

export const REST_SEARCH_LIMIT_MAX = 100;
export const TOOL_SEARCH_LIMIT_MAX = 50;
export const SEARCH_LIMIT_DEFAULT = 20;

const searchFilterFields = {
  query: optionalText(200).describe(
    'One or two distinctive keywords matched against title and description — ' +
      '"the Cloudflare assignment" becomes "Cloudflare". Never the whole sentence.',
  ),
  status: z
    .array(taskStatusSchema)
    .min(1)
    .optional()
    .describe('Match any of these. Unfinished work is ["todo", "in_progress"].'),
  priority: z.array(taskPrioritySchema).min(1).optional().describe('Match any of these.'),
  due_from: dueDate.describe(
    'Earliest due date to include, YYYY-MM-DD and inclusive. Tasks with no due date ' +
      'are excluded whenever this is set.',
  ),
  due_to: dueDate.describe(
    'Latest due date to include, YYYY-MM-DD and inclusive. Tasks with no due date ' +
      'are excluded whenever this is set.',
  ),
};

/**
 * Whether the task has an active schedule — a reminder or a recurring cron —
 * which is a different question from whether it has a due date. Shared wording
 * so the REST filter and the tool argument cannot drift apart.
 */
const SCHEDULED_DESCRIPTION =
  'true returns only tasks that have an active reminder or recurring schedule, ' +
  'false only tasks that have none. This is about being notified, not about due ' +
  'dates: use it for "what am I being reminded about", never for "what is due". ' +
  'Omit it to include both.';

/** Filters accepted by GET /api/tasks. `limit` is coerced from a query param. */
export const searchTasksSchema = z.object({
  ...searchFilterFields,
  // A query param arrives as "true"/"false"; a JSON body sends a real boolean.
  scheduled: z.union([z.boolean(), z.stringbool()]).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(REST_SEARCH_LIMIT_MAX)
    .default(SEARCH_LIMIT_DEFAULT),
});

/**
 * Same filters for the search_tasks tool, with a lower cap so a tool message
 * stays a few KB, and a plain number so the JSON schema shown to the model
 * carries no coercion.
 */
export const searchTasksToolSchema = z.object({
  ...searchFilterFields,
  scheduled: z.boolean().optional().describe(SCHEDULED_DESCRIPTION),
  limit: z
    .number()
    .int()
    .min(1)
    .max(TOOL_SEARCH_LIMIT_MAX)
    .default(SEARCH_LIMIT_DEFAULT)
    .describe('Most tasks to return. The default suits any ordinary request.'),
});

export type SearchTasksInput = z.input<typeof searchTasksSchema>;
export type SearchTasksFilters = z.output<typeof searchTasksSchema>;
