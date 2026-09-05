import type { TaskStatus } from '@/api/types';
import { cn } from '@/lib/cn';

/**
 * Status, encoded twice: by colour and by the shape of a 7px square.
 *
 *   todo         □  hollow
 *   in_progress  ◪  half-filled, and the only thing in the product that pulses
 *   done         ■  solid
 *
 * The glyphs are CSS, not icons. They are a data encoding rather than
 * decoration, so they have to scale with the type and follow `currentColor`
 * rather than live in the icon set's size rhythm.
 *
 * `in_progress` is the sole holder of chroma among the statuses, and the sole
 * user of a sustained animation on a record. It means one thing: this is live.
 */

const LABELS: Record<TaskStatus, string> = {
  todo: 'TODO',
  in_progress: 'ACTIVE',
  done: 'DONE',
};

const DESCRIPTIONS: Record<TaskStatus, string> = {
  todo: 'Status: to do',
  in_progress: 'Status: in progress',
  done: 'Status: done',
};

const TONES: Record<TaskStatus, string> = {
  todo: 'text-todo-fg bg-todo-bg border-todo-border',
  in_progress: 'text-progress-fg bg-progress-bg border-progress-border',
  done: 'text-done-fg bg-done-bg border-done-border',
};

export function StatusGlyph({ status }: { status: TaskStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-[var(--statusglyph-size)] shrink-0 border border-current',
        status === 'done' && 'bg-current',
        status === 'in_progress' &&
          'bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]',
        status === 'in_progress' && 'motion-safe:animate-pulse-live',
      )}
    />
  );
}

export function StatusPill({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span
      title={DESCRIPTIONS[status]}
      className={cn(
        'inline-flex h-[var(--pill-h)] shrink-0 items-center gap-[var(--pill-gap)]',
        'rounded-xs border px-[var(--pill-pad-x)]',
        'font-mono text-micro uppercase',
        TONES[status],
        className,
      )}
    >
      <StatusGlyph status={status} />
      {LABELS[status]}
    </span>
  );
}

export { LABELS as STATUS_LABELS };
