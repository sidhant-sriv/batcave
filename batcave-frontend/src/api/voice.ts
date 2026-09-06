import { request } from './client';

/**
 * Dictation. The recording goes up, text comes back, and nothing else happens:
 * the composer decides what to do with the words, and the user decides whether
 * to send them.
 */

interface TranscribeResponse {
  text: string;
}

export async function transcribe(audio: Blob): Promise<string> {
  const { text } = await request<TranscribeResponse>('/api/transcribe', {
    method: 'POST',
    body: audio,
  });

  return text;
}
