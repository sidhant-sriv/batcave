import { Mic } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Recorder } from '@/lib/voice';

/**
 * Hold to speak.
 *
 * A hold rather than a toggle, so the microphone can never be left open by a
 * click nobody remembers making — releasing is the same gesture as finishing,
 * and letting go of the mouse ends it whatever else has gone wrong.
 *
 * Pointer capture is what makes that promise true: without it, releasing after
 * the cursor has drifted off the button would send `pointerup` somewhere else
 * and leave the recorder running.
 */

interface Props {
  recorder: Recorder;
  disabled?: boolean;
}

export function MicButton({ recorder, disabled = false }: Props) {
  const { state, start, stop } = recorder;
  const listening = state === 'starting' || state === 'recording';

  return (
    <button
      type="button"
      draggable={false}
      disabled={disabled || state === 'transcribing'}
      title="Hold to speak"
      aria-label="Hold to speak"
      aria-pressed={listening}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      // Dragging away and releasing is still a release.
      onLostPointerCapture={stop}
      // A long press on a touch device would otherwise raise the context menu
      // in the middle of a recording.
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        'mb-[2px] inline-flex size-[24px] shrink-0 touch-none select-none items-center',
        'justify-center rounded-xs transition-colors duration-[90ms] ease-sharp',
        'hover:bg-hover hover:text-accent',
        'disabled:pointer-events-none disabled:opacity-40',
        listening ? 'bg-agent-executing-bg text-agent-executing' : 'text-muted',
      )}
    >
      <Mic size={14} strokeWidth={1.5} />
    </button>
  );
}
