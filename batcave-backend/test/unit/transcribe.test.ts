import { describe, expect, it, vi } from 'vitest';
import { ERRORS } from '../../src/errors';
import { AUDIO_MAX_BYTES, TRANSCRIBE_MODEL, transcribe } from '../../src/lib/transcribe';

/**
 * The one place audio becomes a string the agent will act on. Pure: no D1, no
 * network, and a fake binding that records what the model was asked for.
 */

interface FakeAi extends Ai {
  readonly calls: { model: string; input: { audio: string; language: string } }[];
}

function fakeAi(behaviour: { text?: string; throws?: boolean } = {}): FakeAi {
  const calls: FakeAi['calls'] = [];

  return {
    calls,
    run: async (model: string, input: { audio: string; language: string }) => {
      calls.push({ model, input });
      if (behaviour.throws) throw new Error('model unavailable');
      return { text: behaviour.text ?? 'water the plants every monday' };
    },
  } as unknown as FakeAi;
}

/** Audio is only ever bytes to this module, so any bytes will do. */
const audio = (bytes: number[]) => new Uint8Array(bytes).buffer;

describe('transcribe', () => {
  it('asks the whisper model for English and returns the trimmed text', async () => {
    const ai = fakeAi({ text: '  water the plants every monday  ' });

    const result = await transcribe(ai, audio([1, 2, 3]));

    expect(result).toEqual({ ok: true, text: 'water the plants every monday' });
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]!.model).toBe(TRANSCRIBE_MODEL);
    expect(ai.calls[0]!.input.language).toBe('en');
  });

  it('sends the audio as base64 that decodes back to the original bytes', async () => {
    const bytes = [0, 1, 127, 128, 255, 42];
    const ai = fakeAi();

    await transcribe(ai, audio(bytes));

    const decoded = atob(ai.calls[0]!.input.audio);
    expect([...decoded].map((character) => character.charCodeAt(0))).toEqual(bytes);
  });

  it('encodes a payload larger than one chunk without overflowing the stack', async () => {
    // Bigger than the 0x8000 chunk the encoder steps in, which is the whole
    // reason it steps rather than spreading the array in one call.
    const bytes = new Uint8Array(200_000).fill(7);
    const ai = fakeAi();

    const result = await transcribe(ai, bytes.buffer);

    expect(result.ok).toBe(true);
    expect(atob(ai.calls[0]!.input.audio)).toHaveLength(200_000);
  });

  it('refuses an empty body without calling the model', async () => {
    const ai = fakeAi();

    const result = await transcribe(ai, new ArrayBuffer(0));

    expect(result).toEqual({ ok: false, error: ERRORS.AUDIO_REQUIRED });
    expect(ai.calls).toHaveLength(0);
  });

  it('refuses audio over the size cap without calling the model', async () => {
    const ai = fakeAi();

    const result = await transcribe(ai, new ArrayBuffer(AUDIO_MAX_BYTES + 1));

    expect(result).toEqual({ ok: false, error: ERRORS.AUDIO_TOO_LARGE });
    expect(ai.calls).toHaveLength(0);
  });

  it('reports silence rather than putting an empty string in the composer', async () => {
    const result = await transcribe(fakeAi({ text: '   ' }), audio([1, 2, 3]));

    expect(result).toEqual({ ok: false, error: ERRORS.TRANSCRIBE_EMPTY });
  });

  it('reports a model that threw, and logs the cause', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await transcribe(fakeAi({ throws: true }), audio([1, 2, 3]));

    expect(result).toEqual({ ok: false, error: ERRORS.TRANSCRIBE_FAILED });
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});
