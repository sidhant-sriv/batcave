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

/** Optional `YYYY-MM-DD` date, the format we store due dates in. */
const dueDate = optionalText(10).refine(
  (value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value),
  ERRORS.TASK_DUE_DATE_FORMAT,
);

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);

/**
 * The shape TaskService.create() accepts. Both the HTTP route and the Groq
 * agent validate against this before anything reaches D1.
 */
export const createTaskSchema = z.object({
  title: z.string().trim().min(1, ERRORS.TASK_TITLE_REQUIRED).max(200),
  description: optionalText(2000),
  priority: taskPrioritySchema.default('medium'),
  due_date: dueDate,
});

export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type CreateTaskData = z.output<typeof createTaskSchema>;
