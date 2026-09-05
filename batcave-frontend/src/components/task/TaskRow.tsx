import type { AnyTask, Task } from '@/api/types';
import { cn } from '@/lib/cn';
import { useMutationState } from '@/lib/mutationLog';
import { relativeTime } from '@/lib/time';
import { DueChip } from './DueChip';
import { PriorityRail } from './PriorityRail';
import { StatusPill } from './StatusPill';

/**
 * THE SYSTEM RULE
 * ---------------
 * A task looks identical wherever it appears — in the index, on a board card,
 * in a modal header, or inside a chat message. Same glyph, same priority rail,
 * same mono metadata. That identity is what makes a record read as a record
 * regardless of which surface it surfaced on, and it is the strongest available
 * statement that the thing in the transcript is the same row as the thing in
 * the table.
 *
 * Anatomy, left to right:
 *   [priority rail] [status pill] [title] [due chip] [updated, right gutter]
 *
 * Dense by default at 36px. That works because the metadata sits on the row's
 * single baseline rather than stacking under the title.
 */

interface Props {
  task: AnyTask;
  onOpen?: (task: AnyTask) => void;
  /** The right gutter only exists where a full record is available. */
  showUpdated?: boolean;
  /**
   * This row is a snapshot of what a tool returned, not the live record.
   *
   * Transcript rows are history: they show the task as it was at that point in
   * the conversation. Flagging one as "just updated" would be actively
   * misleading — a search result rendered as TODO with an UPDATED badge says
   * two contradictory things. The acknowledgment belongs on the surfaces that
   * show current state, which is where the user would otherwise be surprised.
   */
  historical?: boolean;
  comfy?: boolean;
  selected?: boolean;
  className?: string;
}

function hasTimestamps(task: AnyTask): task is Task {
  return 'updated_at' in task;
}

export function TaskRow({
  task,
  onOpen,
  showUpdated = true,
  historical = false,
  comfy = false,
  selected = false,
  className,
}: Props) {
  const live = useMutationState(task.id);
  const mutation = historical ? 'none' : live;
  const interactive = Boolean(onOpen);

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onOpen?.(task) : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen?.(task);
              }
            }
          : undefined
      }
      className={cn(
        'group flex items-center gap-[var(--task-row-gap)]',
        'border-b border-[var(--task-row-border)] pr-[var(--task-row-pad-x)]',
        'transition-colors duration-[90ms] ease-sharp',
        comfy ? 'h-[var(--task-row-h-comfy)]' : 'h-[var(--task-row-h)]',
        interactive && 'cursor-pointer hover:bg-[var(--task-row-bg-hover)]',
        selected && 'bg-[var(--task-row-bg-selected)]',
        className,
      )}
    >
      <PriorityRail priority={task.priority} mutation={mutation} className="h-full" />

      {/*
       * Every column below the priority rail is fixed-width. In a dense table
       * the title has to start at the same x on every row — and the status
       * pills are not the same width as each other ("ACTIVE" is wider than
       * "TODO"), so a natural-width pill would make the whole title column
       * jitter as statuses change. Same reasoning for the due column, where the
       * chip is sometimes a bordered box and sometimes a bare date.
       */}
      <span className="ml-[var(--space-1)] w-[var(--task-col-status)] shrink-0">
        <StatusPill status={task.status} />
      </span>

      <span
        className={cn(
          'flex min-w-0 flex-1 items-center gap-[var(--space-2)]',
          task.status === 'done' ? 'text-done-title' : 'text-primary',
        )}
      >
        <span
          className={cn('truncate font-prose text-body-sm', task.status === 'done' && 'line-through')}
        >
          {task.title}
        </span>

        {/* The agent changed this underneath the user. Transient, and paired
            with the rail flash rather than replacing it — one signal, two
            channels. It sits inside the title column so it never displaces the
            data columns to its right. */}
        {mutation !== 'none' ? (
          <span className="shrink-0 font-mono text-micro uppercase text-accent">↑ Updated</span>
        ) : null}
      </span>

      <span className="flex w-[var(--task-col-due)] shrink-0 justify-end">
        <DueChip dueDate={task.due_date} status={task.status} />
      </span>

      {showUpdated && hasTimestamps(task) ? (
        <span
          title={task.updated_at}
          className="w-[var(--task-col-updated)] shrink-0 text-right font-mono text-micro uppercase text-muted"
        >
          {relativeTime(task.updated_at)}
        </span>
      ) : null}
    </div>
  );
}
