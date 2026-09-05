import type { AgentAction, AnyTask } from '@/api/types';
import { TaskRow } from '@/components/task/TaskRow';
import { cn } from '@/lib/cn';
import { ordinalLabel } from '@/lib/ordinals';

/**
 * Task records returned into the conversation.
 *
 * This is the "record" half of the transcript/record split, and it is styled to
 * say so: a raised panel with a full hairline and corner register marks, sitting
 * inside a column of unbordered prose. The rows inside it are the *same*
 * `TaskRow` the index uses, which is the strongest available statement that
 * this is the row from the table and not a retelling of it.
 *
 * ORDINALS
 * The 24px mono gutter is not decoration. Users say "mark the first one as
 * done", and for that to resolve, the number on screen has to be the number the
 * model saw — which is the position in the tool result array. Never sort,
 * filter, or de-duplicate a result block.
 */

interface Props {
  action: AgentAction;
  onOpenTask?: (task: AnyTask) => void;
  /** Renders each row as a choice. Used by the disambiguation prompt. */
  onSelect?: (index: number, task: AnyTask) => void;
  className?: string;
}

export function ToolResultBlock({ action, onOpenTask, onSelect, className }: Props) {
  const tasks = action.tasks ?? (action.task ? [action.task] : []);
  if (tasks.length === 0) return null;

  const selectable = Boolean(onSelect);

  return (
    <div
      className={cn(
        'ticked ml-[var(--toolchip-indent)] max-w-[var(--msg-max-w)]',
        'border border-[var(--toolresult-border)] bg-[var(--toolresult-bg)]',
        className,
      )}
    >
      <header
        className={cn(
          'flex items-center justify-between border-b border-hairline',
          'px-[var(--space-3)] py-[var(--space-1)]',
          'font-mono text-micro uppercase text-muted',
        )}
      >
        {/* The chip directly above already names the tool; repeating it here
            would spend a line on nothing. What the block adds is the count. */}
        <span>Records</span>
        <span>{tasks.length}</span>
      </header>

      <ol>
        {tasks.map((task, index) => (
          <li key={task.id} className="flex items-stretch">
            <span
              aria-hidden
              className={cn(
                'flex w-[var(--toolresult-ordinal-w)] shrink-0 items-center justify-center',
                'border-b border-r border-hairline',
                'font-mono text-mono-sm text-muted',
              )}
            >
              {ordinalLabel(index)}
            </span>

            {selectable ? (
              <button
                type="button"
                onClick={() => onSelect?.(index, task)}
                className="min-w-0 flex-1 text-left hover:bg-hover"
              >
                <TaskRow task={task} showUpdated={false} historical className="pointer-events-none" />
              </button>
            ) : (
              <TaskRow task={task} onOpen={onOpenTask} showUpdated={false} historical className="flex-1" />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
