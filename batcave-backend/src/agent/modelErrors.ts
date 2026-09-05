import { APIConnectionTimeoutError, APIError } from 'groq-sdk';
import { ERROR_TEMPLATES } from '../errors';

const MAX_CAUSE_DEPTH = 10;
const MESSAGE_MAX = 300;

export interface ModelFailure {
  status: 502 | 504;
  message: string;
}

/**
 * Groq failures arrive wrapped in whatever the graph added on the way out, so
 * the cause chain is walked rather than only the outermost error. The timeout
 * check comes first because it is a subclass of APIError.
 */
export function classifyModelError(error: unknown): ModelFailure | null {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (current instanceof APIConnectionTimeoutError) {
      return { status: 504, message: ERROR_TEMPLATES.modelUnavailable('request timed out') };
    }
    if (current instanceof APIError) {
      return {
        status: 502,
        message: ERROR_TEMPLATES.modelUnavailable(current.message.slice(0, MESSAGE_MAX)),
      };
    }
    if (!(current instanceof Error)) return null;
    current = current.cause;
  }

  return null;
}
