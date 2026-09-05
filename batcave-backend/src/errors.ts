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
  INVALID_SEARCH_FILTERS: 'Invalid search filters',
  TASK_NOT_FOUND: 'Task not found',
  TASK_INSERT_NO_ROW: 'Insert did not return the created task',

  TASK_TITLE_REQUIRED: 'title is required',
  TASK_DUE_DATE_FORMAT: 'due_date must be a YYYY-MM-DD date',
  TASK_ID_INVALID: 'id must be a UUID',
  TASK_UPDATE_EMPTY: 'At least one field must be provided',

  INVALID_CHAT_INPUT: 'Invalid chat input',
  CHAT_MESSAGE_REQUIRED: 'message is required',
  GROQ_API_KEY_MISSING: 'GROQ_API_KEY is not configured',

  AGENT_TASK_ID_NOT_SEEN:
    'Unknown task id. Call search_tasks first and use an id from its results.',
  AGENT_TOO_MANY_STEPS:
    "I couldn't finish that in a reasonable number of steps. Could you narrow it down?",
  AGENT_UNAVAILABLE: 'The assistant is temporarily unavailable. Please try again.',
  THREAD_BUSY: 'Another message on this conversation is still being processed',
} as const;

/** Messages that need runtime detail interpolated into them. */
export const ERROR_TEMPLATES = {
  modelUnavailable: (reason: string) => `Could not reach the model: ${reason}`,
  toolInfrastructureFailure: (tool: string) => `The ${tool} tool failed`,
} as const;
