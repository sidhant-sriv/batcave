import { ChatGroq } from '@langchain/groq';
import type { Env } from '../types/task';

/**
 * Matches the `GROQ_MODEL` var in wrangler.jsonc, so the fallback and the
 * configured model are the same thing rather than two different answers.
 */
export const DEFAULT_MODEL = 'qwen/qwen3.8-27b';

/** Long enough for a slow tool-calling round, short enough to stay inside a request. */
export const MODEL_TIMEOUT_MS = 30_000;

export function makeModel(env: Env, fetchImpl?: typeof fetch): ChatGroq {
  return new ChatGroq({
    apiKey: env.GROQ_API_KEY,
    model: env.GROQ_MODEL ?? DEFAULT_MODEL,
    temperature: 0,
    maxRetries: 1,
    timeout: MODEL_TIMEOUT_MS,
    // Injectable so tests can assert on the request body without a live Groq.
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}
