import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { ERRORS } from '../src/errors';
import type { TranscribeFn, TranscribeResult } from '../src/lib/transcribe';
import { createTranscribeRoute } from '../src/routes/transcribe';
import type { Env } from '../src/types/task';

/**
 * The route's whole job is turning a result into a status, so the model is
 * stubbed and what is asserted is the mapping — plus that the raw body really
 * arrives as bytes, which is the one thing a JSON-shaped test would not catch.
 */

interface Sent {
  bytes: number[];
}

function appWith(result: TranscribeResult, sent: Sent = { bytes: [] }) {
  const transcribe: TranscribeFn = async (_ai, audio) => {
    sent.bytes = [...new Uint8Array(audio)];
    return result;
  };

  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/transcribe', createTranscribeRoute({ transcribe }));
  return app;
}

const post = (app: Hono<{ Bindings: Env }>, body: BodyInit) =>
  app.request('/api/transcribe', { method: 'POST', body }, env);

describe('POST /api/transcribe', () => {
  it('answers with the transcribed text', async () => {
    const app = appWith({ ok: true, text: 'remind me about the domain renewal on friday' });

    const response = await post(app, new Uint8Array([1, 2, 3]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: 'remind me about the domain renewal on friday',
    });
  });

  it('hands the model the exact bytes it was sent', async () => {
    const sent: Sent = { bytes: [] };
    const app = appWith({ ok: true, text: 'ok' }, sent);

    await post(app, new Uint8Array([0, 127, 255, 42]));

    expect(sent.bytes).toEqual([0, 127, 255, 42]);
  });

  it('reads a megabyte of audio without truncating it', async () => {
    const sent: Sent = { bytes: [] };
    const app = appWith({ ok: true, text: 'ok' }, sent);

    await post(app, new Uint8Array(1_000_000).fill(9));

    expect(sent.bytes).toHaveLength(1_000_000);
  });

  it('rejects a request with no audio', async () => {
    const response = await post(appWith({ ok: false, error: ERRORS.AUDIO_REQUIRED }), '');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: ERRORS.AUDIO_REQUIRED });
  });

  it('rejects audio over the size cap', async () => {
    const app = appWith({ ok: false, error: ERRORS.AUDIO_TOO_LARGE });

    const response = await post(app, new Uint8Array([1]));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: ERRORS.AUDIO_TOO_LARGE });
  });

  it('rejects a recording nobody spoke into', async () => {
    const app = appWith({ ok: false, error: ERRORS.TRANSCRIBE_EMPTY });

    const response = await post(app, new Uint8Array([1]));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: ERRORS.TRANSCRIBE_EMPTY });
  });

  /** The only failure that is not the caller's fault, and the only retryable one. */
  it('reports a model that fell over as an upstream failure', async () => {
    const app = appWith({ ok: false, error: ERRORS.TRANSCRIBE_FAILED });

    const response = await post(app, new Uint8Array([1]));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: ERRORS.TRANSCRIBE_FAILED });
  });
});
