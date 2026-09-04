/**
 * Every user-facing error message lives here. Routes, services and the agent
 * import from this file rather than inlining strings, so wording stays
 * consistent and can be changed in one place.
 */
export const ERRORS = {
  NOT_FOUND: 'Not found',
  INTERNAL_SERVER_ERROR: 'Internal server error',
  INVALID_JSON_BODY: 'Request body must be valid JSON',

  INVALID_TASK_INPUT: 'Invalid task input',
  TASK_NOT_FOUND: 'Task not found',
  TASK_INSERT_NO_ROW: 'Insert did not return the created task',

  TASK_TITLE_REQUIRED: 'title is required',
  TASK_DUE_DATE_FORMAT: 'due_date must be a YYYY-MM-DD date',

  INVALID_CHAT_INPUT: 'Invalid chat input',
  CHAT_MESSAGE_REQUIRED: 'message is required',
  GROQ_API_KEY_MISSING: 'GROQ_API_KEY is not configured',

  MODEL_TOOL_ARGS_MALFORMED: 'Model returned malformed tool arguments',
  MODEL_TOOL_ARGS_NOT_JSON: 'tool arguments were not valid JSON',
  MODEL_TASK_ARGS_INVALID: 'Model returned invalid task arguments',
} as const;

/** Messages that need runtime detail interpolated into them. */
export const ERROR_TEMPLATES = {
  groqUnreachable: (reason: string) => `Could not reach Groq: ${reason}`,
  groqBadResponse: (status: number, body: string) =>
    `Groq returned ${status}: ${body.slice(0, 500)}`,
} as const;
