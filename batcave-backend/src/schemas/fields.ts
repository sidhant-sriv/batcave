import { z } from 'zod';

/**
 * Optional free text. Models routinely emit "" for fields they have nothing
 * for, so a blank value is normalised to null rather than stored as empty.
 */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/**
 * Tri-state field for updates: absent leaves the column alone, null or ""
 * clears it. `optionalText` cannot be reused here because it collapses
 * undefined to null, which would wipe the field on every unrelated change.
 */
export const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value ? value : null));
