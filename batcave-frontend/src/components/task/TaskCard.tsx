import type { AnyTask } from '@/api/types';
import { cn } from '@/lib/cn';
import { useMutationState } from '@/lib/mutationLog';
import { DueChip } from './DueChip';
import { PriorityRail } from './PriorityRail';
import { StatusPill } from './StatusPill';

/**
 * The same record, laid out for a column rather than a row.
 *
 * Used by the board view and by task results inside the transcript. Deliberately
 * the same parts as `TaskRow` in the same order — reading down instead of
 * across — so that moving a task between surfaces never changes what it is.
 */

interface Props {
  task: AnyTask;
  onOpen?: (task: AnyTask) => void;
  className?: string;
}

export function TaskCard({ task, onOpen, className }: Props) {
  const mutation = useMutationState(task.id);
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
        'flex min-h-[var(--task-card-min-h)] gap-[var(--space-3)]',
        'border border-[var(--task-card-border)] bg-[var(--task-card-bg)]',
        'p-[var(--task-card-pad)] transition-colors duration-[90ms] ease-sharp',
        interactive && 'cursor-pointer hover:bg-raised',
        className,
      )}
    >
      <PriorityRail priority={task.priority} mutation={mutation} className="self-stretch" />

      <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-2)]">
        <span
          className={cn(
            'font-prose text-body-sm',
            task.status === 'done' ? 'text-done-title line-through' : 'text-primary',
          )}
        >
          {task.title}
        </span>

        {task.description ? (
          <p className="line-clamp-2 font-prose text-body-sm text-muted">{task.description}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <StatusPill status={task.status} />
          <DueChip dueDate={task.due_date} status={task.status} />
          {mutation !== 'none' ? (
            <span className="font-mono text-micro uppercase text-accent">↑ Updated</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
