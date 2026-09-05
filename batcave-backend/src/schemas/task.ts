import { z } from 'zod';
import { ERRORS } from '../errors';
import { TASK_PRIORITIES, TASK_STATUSES } from '../types/task';

/**
 * Optional free text. Models routinely emit "" for fields they have nothing
 * for, so a blank value is normalised to null rather than stored as empty.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Optional `YYYY-MM-DD` date, the format we store due dates in. */
const dueDate = optionalText(10).refine(
  (value) => value === null || DUE_DATE_PATTERN.test(value),
  ERRORS.TASK_DUE_DATE_FORMAT,
);

/**
 * Tri-state field for updates: absent leaves the column alone, null or "" 
 * clears it. `optionalText` cannot be reused here because it collapses
 * undefined to null, which would wipe the field on every unrelated change.
 */
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value ? value : null));

const clearableDueDate = clearableText(10).refine(
  (value) => value === undefined || value === null || DUE_DATE_PATTERN.test(value),
  ERRORS.TASK_DUE_DATE_FORMAT,
);

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export const taskIdSchema = z.uuid(ERRORS.TASK_ID_INVALID);

/**
 * The shape TaskService.create() accepts. Both the HTTP route and the agent
 * tool validate against this before anything reaches D1.
 */
export const createTaskSchema = z.object({
  title: z.string().trim().min(1, ERRORS.TASK_TITLE_REQUIRED).max(200),
  description: optionalText(2000),
  priority: taskPrioritySchema.default('medium'),
  due_date: dueDate,
});

export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type CreateTaskData = z.output<typeof createTaskSchema>;

/**
 * Fields a task update may change. Kept as a bare shape so both the REST body
 * schema and the flat tool schema (which adds `id`) can be built from it.
 */
const updateTaskFields = {
  title: z.string().trim().min(1, ERRORS.TASK_TITLE_REQUIRED).max(200).optional(),
  description: clearableText(2000),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  due_date: clearableDueDate,
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
  .object({ id: taskIdSchema, ...updateTaskFields })
  .refine(hasSomeChange, { message: ERRORS.TASK_UPDATE_EMPTY });

export const REST_SEARCH_LIMIT_MAX = 100;
export const TOOL_SEARCH_LIMIT_MAX = 50;
export const SEARCH_LIMIT_DEFAULT = 20;

const searchFilterFields = {
  query: optionalText(200),
  status: z.array(taskStatusSchema).min(1).optional(),
  priority: z.array(taskPrioritySchema).min(1).optional(),
  due_from: dueDate,
  due_to: dueDate,
};

/** Filters accepted by GET /api/tasks. `limit` is coerced from a query param. */
export const searchTasksSchema = z.object({
  ...searchFilterFields,
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
  limit: z
    .number()
    .int()
    .min(1)
    .max(TOOL_SEARCH_LIMIT_MAX)
    .default(SEARCH_LIMIT_DEFAULT),
});

export type SearchTasksInput = z.input<typeof searchTasksSchema>;
export type SearchTasksFilters = z.output<typeof searchTasksSchema>;
