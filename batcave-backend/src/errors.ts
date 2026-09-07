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

  CHAT_NOT_FOUND: 'Conversation not found',
  CHAT_ID_INVALID: 'chat_id must be a UUID',
  CHAT_BUSY: 'A turn is still running on this conversation',
  CHAT_TITLE_REQUIRED: 'title is required',
  INVALID_CHAT_UPDATE: 'Invalid chat update',
  INVALID_CHAT_LIST: 'Invalid chat list options',

  INVALID_SCHEDULE_INPUT: 'Invalid schedule input',
  INVALID_SCHEDULE_LIST: 'Invalid schedule list options',
  INVALID_NOTIFICATION_LIST: 'Invalid notification list options',
  SCHEDULE_NOT_FOUND: 'No active schedule for that task',
  NOTIFICATION_NOT_FOUND: 'Notification not found',
  SCHEDULE_ID_INVALID: 'schedule id must be a UUID',
  NOTIFICATION_ID_INVALID: 'notification id must be a UUID',
  SCHEDULE_REMIND_AT_FORMAT: 'remind_at must be an ISO 8601 date-time such as 2026-09-11T09:00:00Z',
  SCHEDULE_IN_PAST: 'remind_at must be in the future',
  SCHEDULE_TOO_FAR: 'remind_at must be within a year',
  SCHEDULE_TASK_DONE: 'Cannot set a reminder on a finished task',
  SCHEDULE_CRON_INVALID: 'cron must be a valid 5-field expression, e.g. "0 9 * * 1"',
  SCHEDULE_CRON_NO_RUN: 'cron never fires',
  SCHEDULE_CRON_TOO_FREQUENT: 'cron must not fire more often than every 15 minutes',
  SCHEDULE_INSERT_NO_ROW: 'Insert did not return the created schedule',
  NOTIFICATION_INSERT_NO_ROW: 'Insert did not return the notification',

  UNAUTHORIZED: 'Sign in to use this API',
  AUTH_TOKEN_INVALID: 'That access token is expired or not valid',

  OAUTH_INVALID_REQUEST: 'Invalid authorization request',
  OAUTH_CONSENT_EXPIRED: 'That consent form expired. Start the connection again.',
  OAUTH_STATE_INVALID: 'This sign-in did not start in this browser. Start again.',
  GITHUB_DENIED: 'GitHub sign-in was cancelled',
  GITHUB_EXCHANGE_FAILED: 'Could not complete GitHub sign-in',
  GITHUB_USER_FAILED: 'Could not read your GitHub account',

  MCP_TOOL_UNAVAILABLE: 'The tool could not run. This is a fault on our side, not your request.',
  MCP_MISSING_IDENTITY: 'Grant carries no GitHub login',

  AUDIO_REQUIRED: 'No audio was sent',
  AUDIO_TOO_LARGE: 'Audio must be under 8 MB',
  TRANSCRIBE_EMPTY: 'Nothing was said',
  TRANSCRIBE_FAILED: 'Could not transcribe the audio',
} as const;

/** Messages that need runtime detail interpolated into them. */
export const ERROR_TEMPLATES = {
  modelUnavailable: (reason: string) => `Could not reach the model: ${reason}`,
  toolInfrastructureFailure: (tool: string) => `The ${tool} tool failed`,
} as const;
