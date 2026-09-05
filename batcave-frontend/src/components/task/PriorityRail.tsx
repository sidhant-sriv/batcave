import type { TaskPriority } from '@/api/types';
import { cn } from '@/lib/cn';
import type { MutationState } from '@/lib/mutationLog';

/**
 * Priority — deliberately achromatic.
 *
 * Priority and status sit beside each other on every row, so they are separated
 * by channel rather than by hue:
 *
 *   status    colour + a square glyph, inline with the title
 *   priority  filled-segment count + a fixed position, the row's left edge
 *
 * Nothing here is decodable only by colour, because nothing here uses colour at
 * all. High priority is pure white on warm near-black, which reads harder than
 * a red would and costs nothing from the accent budget.
 *
 * The rail doubles as the update-acknowledgment surface: when the agent changes
 * a record, this is what flashes. Putting the two on the same element is
 * intentional — the eye is already trained to check the left edge of the row.
 */

const FILLED: Record<TaskPriority, number> = { low: 1, medium: 2, high: 3 };

const FILL_COLOR: Record<TaskPriority, string> = {
  low: 'bg-priority-low',
  medium: 'bg-priority-med',
  high: 'bg-priority-high',
};

const LABELS: Record<TaskPriority, string> = { low: 'LOW', medium: 'MED', high: 'HIGH' };

interface Props {
  priority: TaskPriority;
  /** Drives the acknowledgment treatment; omit outside the task surfaces. */
  mutation?: MutationState;
  className?: string;
}

export function PriorityRail({ priority, mutation = 'none', className }: Props) {
  const filled = FILLED[priority];

  return (
    <span
      title={`Priority: ${priority}`}
      className={cn('flex shrink-0 flex-col justify-center gap-[var(--priority-seg-gap)]', className)}
    >
      <span className="sr-only">Priority {priority}</span>

      {[2, 1, 0].map((segment) => {
        const isFilled = segment < filled;

        return (
          <span
            key={segment}
            aria-hidden
            className={cn(
              'block w-[var(--priority-rail-w)] h-[var(--priority-seg-h)]',
              isFilled ? FILL_COLOR[priority] : 'bg-priority-track',
              // The agent just changed this record. A flash decays back to the
              // rail's resting value; a mark holds until the user engages.
              mutation === 'flash' &&
                'motion-safe:animate-[register_var(--dur-register)_var(--ease-sharp)]',
              mutation !== 'none' && 'bg-accent',
            )}
          />
        );
      })}
    </span>
  );
}

export { LABELS as PRIORITY_LABELS };
