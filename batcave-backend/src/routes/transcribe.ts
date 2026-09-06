import { Hono } from 'hono';
import { ERRORS } from '../errors';
import { transcribe as runTranscribe, type TranscribeFn } from '../lib/transcribe';
import type { Env } from '../types/task';

/**
 * Audio in, text out. That is the whole endpoint.
 *
 * It deliberately knows nothing about tasks, chats or the agent: the composer
 * puts the text it returns into a box the user still has to read and send. That
 * separation is the safety property of the feature — a mis-heard word can never
 * reach a tool without a human pressing Enter first — and it is also why this
 * route has no service and touches no table.
 *
 * A factory so tests can substitute the model, matching `createChatRoute`.
 */
export function createTranscribeRoute(options: { transcribe?: TranscribeFn } = {}) {
  const route = new Hono<{ Bindings: Env }>();
  const transcribe = options.transcribe ?? runTranscribe;

  /**
   * The body is the raw recording, not JSON and not multipart. There is exactly
   * one field, so a wrapper would only cost a base64 round trip on the way in.
   */
  route.post('/', async (c) => {
    const result = await transcribe(c.env.AI, await c.req.arrayBuffer());

    if (!result.ok) {
      const status = result.error === ERRORS.TRANSCRIBE_FAILED ? 502 : 400;
      return c.json({ error: result.error }, status);
    }

    return c.json({ text: result.text });
  });

  return route;
}

export const transcribeRoute = createTranscribeRoute();
