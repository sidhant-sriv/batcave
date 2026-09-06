import { useCallback, useEffect, useRef, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';
import { CHAT_MESSAGE_MAX } from '@/api/chats';
import { cn } from '@/lib/cn';
import { formatElapsed, useRecorder, type Recorder } from '@/lib/voice';
import { MicButton } from './MicButton';

/**
 * The message box.
 *
 * Locks while a turn is in flight rather than queueing. The backend allows only
 * one turn per conversation at a time and answers a second with a 409, so a
 * composer that accepted input during execution would be promising something
 * the server will refuse. Better to make the constraint visible.
 *
 * Dictation fills this box; it never sends. The agent mutates — it creates
 * tasks, reopens them, cancels schedules — and a transcript is a guess. Landing
 * the words somewhere the user reads them before pressing Enter is what keeps a
 * mis-heard syllable from reaching a tool.
 */

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
  /** Replaces the placeholder while a turn runs or a conversation is locked. */
  status?: string;
  autoFocus?: boolean;
}

export function Composer({ onSend, disabled = false, status, autoFocus }: Props) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  /** Where to leave the caret once a dictated insert has been applied. */
  const caret = useRef<number | null>(null);

  // Grow with the content, up to a ceiling. Beyond that it scrolls, so the
  // transcript above never gets squeezed out by a long message.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  // Focus returns to the composer the moment a turn finishes, so the next
  // message can be typed without reaching for the mouse.
  useEffect(() => {
    if (!disabled && autoFocus) ref.current?.focus();
  }, [disabled, autoFocus]);

  /**
   * Speech lands at the cursor rather than replacing the box. Someone who typed
   * half a sentence and then reached for the microphone meant to add to it, and
   * eating their typing would be the one unforgivable bug in this feature.
   */
  const insert = useCallback((text: string) => {
    const el = ref.current;
    const from = el?.selectionStart ?? null;
    const to = el?.selectionEnd ?? null;

    setValue((current) => {
      const head = current.slice(0, from ?? current.length);
      const tail = current.slice(to ?? current.length);
      // Speech arrives with no leading space, so one is supplied where the join
      // would otherwise weld two words together.
      const gap = head && !/\s$/.test(head) ? ' ' : '';

      caret.current = (head + gap + text).length;
      return `${head}${gap}${text}${tail}`.slice(0, CHAT_MESSAGE_MAX);
    });
  }, []);

  const recorder = useRecorder(insert);

  // Runs after the dictated value has been committed, which is the only moment
  // the caret can be placed at the end of what was just said.
  useEffect(() => {
    if (caret.current === null) return;

    const el = ref.current;
    const at = Math.min(caret.current, value.length);
    caret.current = null;

    el?.focus();
    el?.setSelectionRange(at, at);
  }, [value]);

  const send = () => {
    const message = value.trim();
    if (!message || disabled) return;
    onSend(message);
    setValue('');
  };

  const remaining = CHAT_MESSAGE_MAX - value.length;
  const hint = hintOf(recorder);

  return (
    <div
      className={cn(
        'flex flex-col gap-[var(--space-2)] border-t border-divider',
        'bg-app px-[var(--space-4)] py-[var(--space-3)]',
      )}
    >
      <div
        className={cn(
          'flex items-end gap-[var(--space-2)] rounded-xs border',
          'border-[var(--composer-border)] bg-[var(--composer-bg)]',
          'px-[var(--space-3)] py-[var(--space-2)]',
          'transition-colors duration-[90ms] ease-sharp',
          'focus-within:border-focus',
          disabled && 'opacity-60',
        )}
      >
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          maxLength={CHAT_MESSAGE_MAX}
          placeholder={status ?? 'Ask the agent to find, create or change a task'}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line. The console is for
            // instructions, not paragraphs, so the common case gets the bare key.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          className={cn(
            'min-h-[24px] flex-1 resize-none bg-transparent',
            'font-prose text-body text-primary placeholder:text-disabled',
            'focus-visible:shadow-none',
          )}
        />

        {/* Absent rather than disabled where the browser cannot record: a
            button that could never work is worse than no button. */}
        {recorder.supported ? <MicButton recorder={recorder} disabled={disabled} /> : null}

        <button
          type="button"
          onClick={send}
          disabled={disabled || value.trim().length === 0}
          title="Send"
          aria-label="Send"
          className={cn(
            'mb-[2px] inline-flex size-[24px] shrink-0 items-center justify-center rounded-xs',
            'text-muted transition-colors duration-[90ms] ease-sharp',
            'hover:bg-hover hover:text-accent',
            'disabled:pointer-events-none disabled:opacity-40',
          )}
        >
          <CornerDownLeft size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex items-center justify-between font-mono text-micro uppercase text-disabled">
        <span className={hint.tone} role={recorder.state === 'idle' ? undefined : 'status'}>
          {hint.text}
        </span>
        {remaining < 200 ? <span>{remaining} left</span> : null}
      </div>
    </div>
  );
}

/**
 * Row two doubles as the recorder's status line. That is why voice needed no
 * new layout here: the composer already had somewhere honest to say what it was
 * doing, and a microphone is mostly a thing that needs saying.
 */
function hintOf(recorder: Recorder): { text: string; tone: string } {
  switch (recorder.state) {
    case 'starting':
      return { text: 'Opening the microphone…', tone: 'text-muted' };
    case 'recording':
      return {
        text: `● Listening ${formatElapsed(recorder.elapsedMs)} · Release to transcribe`,
        tone: 'text-agent-executing',
      };
    case 'transcribing':
      return { text: 'Transcribing…', tone: 'text-muted' };
    default:
      return recorder.error
        ? { text: recorder.error, tone: 'text-agent-error' }
        : { text: 'Enter to send · Shift+Enter for a new line', tone: 'text-disabled' };
  }
}
