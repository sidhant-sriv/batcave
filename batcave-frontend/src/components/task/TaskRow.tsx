import { Repeat } from 'lucide-react';
import type { AnyTask, Schedule, Task } from '@/api/types';
import { cn } from '@/lib/cn';
import { describeCron } from '@/lib/cron';
import { useMutationState } from '@/lib/mutationLog';
import { relativeTime, shortDate } from '@/lib/time';
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
 *   [priority rail] [status pill] [title ↻] [schedule] [due chip] [updated]
 *
 * Dense by default at 36px. That works because the metadata sits on the row's
 * single baseline rather than stacking under the title.
 *
 * STACKED is the phone. Two lines instead of six columns, because at 390px the
 * fixed columns would leave the title about twelve characters. What survives is
 * what a row is for: how urgent, what state, what it says, when it is due.
 */

interface Props {
  task: AnyTask;
  onOpen?: (task: AnyTask) => void;
  /** The right gutter only exists where a full record is available. */
  showUpdated?: boolean;
  /**
   * The active schedule this task carries, if any. A task has at most one.
   *
   * A schedule is a facet of the task, not a separate noun — so it renders here
   * rather than on a surface of its own: a glyph beside the title always, and a
   * column of its own where the table is wide enough to hold one.
   */
  schedule?: Schedule | null;
  showSchedule?: boolean;
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
  stacked?: boolean;
  selected?: boolean;
  className?: string;
}

function hasTimestamps(task: AnyTask): task is Task {
  return 'updated_at' in task;
}

/** What the schedule column says. `null` when there is nothing to say. */
export function scheduleLabel(schedule: Schedule | null | undefined): string | null {
  if (!schedule || schedule.status !== 'active') return null;

  return schedule.kind === 'recurring' && schedule.cron
    ? describeCron(schedule.cron)
    : `Once · ${shortDate(schedule.next_at)}`;
}

export function TaskRow({
  task,
  onOpen,
  showUpdated = true,
  schedule = null,
  showSchedule = false,
  historical = false,
  comfy = false,
  stacked = false,
  selected = false,
  className,
}: Props) {
  const live = useMutationState(task.id);
  const mutation = historical ? 'none' : live;
  const interactive = Boolean(onOpen);
  const label = scheduleLabel(schedule);

  const behaviour = {
    role: interactive ? ('button' as const) : undefined,
    tabIndex: interactive ? 0 : undefined,
    onClick: interactive ? () => onOpen?.(task) : undefined,
    onKeyDown: interactive
      ? (event: React.KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen?.(task);
          }
        }
      : undefined,
  };

  const surface = cn(
    'group border-b border-[var(--task-row-border)]',
    'transition-colors duration-[90ms] ease-sharp',
    interactive && 'cursor-pointer hover:bg-[var(--task-row-bg-hover)]',
    selected && 'bg-[var(--task-row-bg-selected)]',
    className,
  );

  const title = (
    <span
      className={cn(
        'truncate font-prose text-body-sm',
        task.status === 'done' && 'line-through',
      )}
    >
      {task.title}
    </span>
  );

  /* The agent changed this underneath the user. Transient, and paired with the
     rail flash rather than replacing it — one signal, two channels. */
  const updated =
    mutation !== 'none' ? (
      <span className="shrink-0 font-mono text-micro uppercase text-accent">↑ Updated</span>
    ) : null;

  if (stacked) {
    return (
      <div
        {...behaviour}
        className={cn(surface, 'flex min-h-[56px] items-center gap-[var(--space-3)] pr-[var(--space-3)]')}
      >
        <PriorityRail priority={task.priority} mutation={mutation} className="h-[21px]" />

        <span className="flex min-w-0 flex-1 flex-col gap-[3px] py-[var(--space-2)]">
          {/* min-w-0 all the way down, or the title refuses to truncate and
              pushes the due chip off the side of the phone instead. */}
          <span
            className={cn(
              'flex min-w-0 items-center gap-[var(--space-2)]',
              task.status === 'done' ? 'text-done-title' : 'text-primary',
            )}
          >
            <StatusPill status={task.status} />
            {title}
          </span>

          {label ? (
            <span className="flex items-center gap-[4px] font-mono text-micro uppercase text-muted">
              <Repeat size={10} strokeWidth={1.5} aria-hidden />
              {label}
            </span>
          ) : null}

          {updated}
        </span>

        <DueChip dueDate={task.due_date} status={task.status} />
      </div>
    );
  }

  return (
    <div
      {...behaviour}
      className={cn(
        surface,
        'flex items-center gap-[var(--task-row-gap)] pr-[var(--task-row-pad-x)]',
        comfy ? 'h-[var(--task-row-h-comfy)]' : 'h-[var(--task-row-h)]',
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
        {title}

        {/* The glyph rides with the title rather than the column, so a
            scheduled task is still marked as one on a surface too narrow to
            carry the column — and in a transcript, which never has it. */}
        {label ? (
          <Repeat
            size={11}
            strokeWidth={1.5}
            className="shrink-0 text-muted"
            aria-label="Has a schedule"
          />
        ) : null}

        {updated}
      </span>

      {showSchedule ? (
        <span className="w-[var(--task-col-sched)] shrink-0 truncate text-right font-mono text-micro uppercase text-muted">
          {label ?? '—'}
        </span>
      ) : null}

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
