import { ERRORS } from '../errors';

/**
 * Speech to text, kept as a thin adapter over one Workers AI model.
 *
 * Takes the binding as a parameter rather than reaching for `env`, so the unit
 * test can hand it a fake and assert what the model was actually asked for. It
 * returns a result rather than throwing for the same reason `lib/cron.ts` does:
 * every rejection here is something the caller turns into a specific status,
 * and none of them are exceptional enough to unwind through `onError`.
 */

export const TRANSCRIBE_MODEL = '@cf/openai/whisper-large-v3-turbo';

/**
 * Roughly thirty minutes of Opus, which is far beyond the sixty seconds the
 * composer will record. It exists to bound what an unauthenticated caller can
 * push through a paid model, not to constrain the UI.
 */
export const AUDIO_MAX_BYTES = 8 * 1024 * 1024;

/** The one language this application speaks; naming it beats auto-detection
 *  on the short, clipped phrases people dictate into a command box. */
const LANGUAGE = 'en';

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

/** What the route needs, so a test can substitute for the whole module. */
export type TranscribeFn = (ai: Ai, audio: ArrayBuffer) => Promise<TranscribeResult>;

export async function transcribe(ai: Ai, audio: ArrayBuffer): Promise<TranscribeResult> {
  if (audio.byteLength === 0) return { ok: false, error: ERRORS.AUDIO_REQUIRED };
  if (audio.byteLength > AUDIO_MAX_BYTES) return { ok: false, error: ERRORS.AUDIO_TOO_LARGE };

  let response: { text?: string };
  try {
    response = await ai.run(TRANSCRIBE_MODEL, {
      audio: toBase64(audio),
      language: LANGUAGE,
    });
  } catch (error) {
    console.error('Transcription failed:', error);
    return { ok: false, error: ERRORS.TRANSCRIBE_FAILED };
  }

  // A short recording with nothing in it comes back empty or as a lone space,
  // and neither belongs in the composer.
  const text = response.text?.trim() ?? '';
  if (!text) return { ok: false, error: ERRORS.TRANSCRIBE_EMPTY };

  return { ok: true, text };
}

/**
 * This model wants base64, unlike `@cf/openai/whisper`, which wants an array of
 * bytes. Chunked because `String.fromCharCode(...bytes)` spreads one argument
 * per byte and overflows the stack somewhere around a hundred kilobytes.
 */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary);
}
