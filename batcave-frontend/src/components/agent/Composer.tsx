import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';
import { CHAT_MESSAGE_MAX } from '@/api/chats';
import { cn } from '@/lib/cn';

/**
 * The message box.
 *
 * Locks while a turn is in flight rather than queueing. The backend allows only
 * one turn per conversation at a time and answers a second with a 409, so a
 * composer that accepted input during execution would be promising something
 * the server will refuse. Better to make the constraint visible.
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

  const send = () => {
    const message = value.trim();
    if (!message || disabled) return;
    onSend(message);
    setValue('');
  };

  const remaining = CHAT_MESSAGE_MAX - value.length;

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
        <span>Enter to send · Shift+Enter for a new line</span>
        {remaining < 200 ? <span>{remaining} left</span> : null}
      </div>
    </div>
  );
}
