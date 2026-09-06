import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { transcribe } from '@/api/voice';

/**
 * Hold to talk.
 *
 * The recorder deliberately stops at text: it hands the words to a callback and
 * the composer puts them in a box the user still has to read and send. Nothing
 * here can reach a tool on its own, which is the point — the agent mutates, and
 * "cancel the plant schedule" and "cancel the plan schedule" differ by a single
 * phoneme.
 *
 * The two pure functions below are separated from the hook because this project
 * has no DOM test setup: what can be tested is what can be made pure.
 */

/**
 * Opus in a WebM container is what Chrome and Firefox produce and what the
 * model handles most cheaply. Safari records AAC in MP4 and nothing else, so it
 * is the fallback rather than an equal.
 */
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const;

/** The first container the browser will actually record, or null if none. */
export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  return MIME_TYPES.find((type) => isSupported(type)) ?? null;
}

/** Elapsed recording time, as `0:04`. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A dictated command is a sentence, not a voicemail. Also bounds the bill. */
export const MAX_RECORDING_MS = 60_000;

/** Below this it was a click, not a hold: discarded without a round trip. */
const MIN_RECORDING_MS = 300;

export type RecorderState = 'idle' | 'starting' | 'recording' | 'transcribing';

export interface Recorder {
  state: RecorderState;
  elapsedMs: number;
  /** Set on failure and on the first permission grant; cleared by the next hold. */
  error: string | null;
  /** False when the browser cannot record at all, in which case there is no button. */
  supported: boolean;
  start: () => void;
  stop: () => void;
}

export function useRecorder(onTranscript: (text: string) => void): Recorder {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timers = useRef<{ tick?: number; cap?: number }>({});
  const startedAt = useRef(0);

  /** Set when the button is released before the stream has opened. */
  const cancelled = useRef(false);
  /** Whether a permission grant has already happened in this page. */
  const granted = useRef(false);

  /**
   * The state is mirrored into a ref because pointerup can arrive while `start`
   * is still awaiting the microphone, and a guard reading a stale closure would
   * miss it.
   */
  const phase = useRef<RecorderState>('idle');
  const setPhase = useCallback((next: RecorderState) => {
    phase.current = next;
    setState(next);
  }, []);

  const handler = useRef(onTranscript);
  useEffect(() => {
    handler.current = onTranscript;
  }, [onTranscript]);

  const supported = useMemo(
    () =>
      typeof MediaRecorder !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      pickMimeType((type) => MediaRecorder.isTypeSupported(type)) !== null,
    [],
  );

  /** Every exit path runs this. A stream left open keeps the browser's
   *  recording indicator lit, which is alarming and entirely our fault. */
  const release = useCallback(() => {
    if (timers.current.tick) window.clearInterval(timers.current.tick);
    if (timers.current.cap) window.clearTimeout(timers.current.cap);
    timers.current = {};

    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
    setElapsedMs(0);
  }, []);

  useEffect(() => release, [release]);

  const start = useCallback(() => {
    if (!supported || phase.current !== 'idle') return;

    cancelled.current = false;
    setError(null);
    setPhase('starting');

    void (async () => {
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (cause) {
        setPhase('idle');
        setError(microphoneError(cause));
        return;
      }

      // The permission dialog takes the pointer with it, so the hold that
      // raised it cannot survive it. Saying the grant landed turns a dead
      // first attempt into an instruction.
      const firstGrant = !granted.current;
      granted.current = true;

      const mimeType = pickMimeType((type) => MediaRecorder.isTypeSupported(type));

      if (cancelled.current || !mimeType) {
        media.getTracks().forEach((track) => track.stop());
        setPhase('idle');
        if (firstGrant) setError('Microphone allowed — hold again to speak');
        return;
      }

      const chunks: Blob[] = [];
      const active = new MediaRecorder(media, { mimeType });

      active.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      active.onstop = () => {
        const held = Date.now() - startedAt.current;
        const audio = new Blob(chunks, { type: mimeType });
        release();

        if (held < MIN_RECORDING_MS || audio.size === 0) {
          setPhase('idle');
          return;
        }

        setPhase('transcribing');
        void (async () => {
          try {
            handler.current(await transcribe(audio));
            setPhase('idle');
          } catch (cause) {
            setPhase('idle');
            setError(cause instanceof Error ? cause.message : 'Could not transcribe the audio');
          }
        })();
      };

      stream.current = media;
      recorder.current = active;
      startedAt.current = Date.now();
      active.start();
      setPhase('recording');

      timers.current.tick = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAt.current);
      }, 100);

      timers.current.cap = window.setTimeout(() => {
        if (active.state === 'recording') active.stop();
      }, MAX_RECORDING_MS);
    })();
  }, [release, setPhase, supported]);

  const stop = useCallback(() => {
    if (phase.current === 'starting') {
      cancelled.current = true;
      return;
    }
    if (phase.current === 'recording' && recorder.current?.state === 'recording') {
      recorder.current.stop();
    }
  }, []);

  return { state, elapsedMs, error, supported, start, stop };
}

function microphoneError(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone blocked — allow it in site settings';
  }
  if (name === 'NotFoundError') return 'No microphone found';

  return 'Could not start the microphone';
}
