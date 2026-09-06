import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Columns3, List, Plus } from 'lucide-react';
import { listTasks, TASK_LIMIT_MAX } from '@/api/tasks';
import type { AnyTask, Task, TaskPriority, TaskStatus } from '@/api/types';
import { Button, IconButton } from '@/components/primitives/Button';
import { NavToggle } from '@/components/nav/NavToggle';
import { EmptyState, ErrorState, LoadingRows } from '@/components/state/States';
import { TaskCard } from '@/components/task/TaskCard';
import { TaskCreateForm } from '@/components/task/TaskCreateForm';
import { TaskDetailModal } from '@/components/task/TaskDetailModal';
import { TaskRow } from '@/components/task/TaskRow';
import { STATUS_LABELS } from '@/components/task/StatusPill';
import { cn } from '@/lib/cn';
import { todayUtc } from '@/lib/dueDate';
import { useDensity } from '@/lib/prefs';
import { useSchedulesByTask } from '@/lib/schedules';
import { useShell } from '@/lib/shell';
import { viewOf } from '@/lib/views';

/**
 * The deterministic surface.
 *
 * Which rows it shows is the navigator's business: `?view=` names a saved view,
 * and the view owns the filter that fetches it. What stays here is the
 * narrowing you do inside a view — a keyword, a priority — because that is a
 * question about these rows rather than about which rows.
 *
 * Ordering is fixed server-side — dated first, then due date ascending, then
 * priority, then age — so there is no sort control here. Offering one that the
 * API cannot honour would be worse than offering none.
 *
 * Row counts: the backend caps `limit` at 100 and reports `truncated`, with no
 * offset or cursor. So the index asks for the maximum and, when there is more,
 * says so plainly in a footer rail rather than implying it is showing
 * everything. That is an honest statement of what the data layer can currently
 * do; real pagination is a backend change.
 */

const STATUS_FILTERS: Array<{ value: TaskStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'todo', label: STATUS_LABELS.todo },
  { value: 'in_progress', label: STATUS_LABELS.in_progress },
  { value: 'done', label: STATUS_LABELS.done },
];

const PRIORITY_FILTERS: Array<{ value: TaskPriority | 'all'; label: string }> = [
  { value: 'all', label: 'Any' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Med' },
  { value: 'low', label: 'Low' },
];

const BOARD_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'done'];

export function TaskIndex() {
  const [searchParams] = useSearchParams();
  const { layout } = useShell();
  const [density, setDensity] = useDensity();
  const [view, setView] = useState<'list' | 'board'>('list');
  const [status, setStatus] = useState<TaskStatus | 'all'>('all');
  const [priority, setPriority] = useState<TaskPriority | 'all'>('all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [openTask, setOpenTask] = useState<Task | null>(null);

  const saved = viewOf(searchParams.get('view'));
  const narrow = layout === 'narrow';
  const schedules = useSchedulesByTask();

  /*
   * The saved view's filter is the floor, and the header can only narrow it
   * further. The status control is therefore hidden outside the All view: in a
   * view called Done, a status filter is either a no-op or a contradiction.
   */
  const filters = useMemo(() => {
    const base = saved.filters(todayUtc());

    return {
      limit: TASK_LIMIT_MAX,
      ...base,
      ...(saved.id === 'all' && status !== 'all' ? { status: [status] } : {}),
      ...(priority === 'all' ? {} : { priority: [priority] }),
      ...(query.trim() ? { query: query.trim() } : {}),
    };
  }, [saved, status, priority, query]);

  const tasks = useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => listTasks(filters),
  });

  // The modal reads from the live list rather than from the row that was
  // clicked, so an agent mutation landing while it is open is visible to it.
  const selected = openTask
    ? (tasks.data?.tasks.find((task) => task.id === openTask.id) ?? openTask)
    : null;

  const comfy = density === 'comfy';
  const rows = tasks.data?.tasks ?? [];
  const filtered = Boolean(query) || status !== 'all' || priority !== 'all';

  // The schedule column costs a fixed 132px. Below the wide breakpoint the
  // title needs that more than the table does, and the glyph still marks the
  // row — so the column goes and the information does not.
  const showSchedule = layout === 'wide';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        className={cn(
          'flex h-[var(--shell-header-h)] shrink-0 items-center gap-[var(--space-3)]',
          'overflow-hidden border-b border-divider px-[var(--space-4)]',
        )}
      >
        <NavToggle />

        <h1 className="flex shrink-0 items-center gap-[var(--space-2)] whitespace-nowrap">
          <span className="font-prose text-body-sm text-primary">{saved.label}</span>
          <span className="font-mono text-micro text-disabled">{rows.length}</span>
        </h1>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by keyword"
          className={cn(
            'h-[24px] rounded-xs border border-control bg-well px-[var(--space-2)]',
            'font-prose text-body-sm text-primary placeholder:text-disabled',
            'hover:border-strong focus:border-focus',
            // On a phone the keyword box takes whatever the row has left, and
            // the segmented filters are gone: the navigator's views cover
            // status, and priority is legible from the rail on every row.
            narrow ? 'min-w-0 flex-1' : 'w-[132px] shrink-0 xl:w-[200px]',
          )}
        />

        {saved.id === 'all' && !narrow ? (
          <SegmentedControl
            label="Status"
            options={STATUS_FILTERS}
            value={status}
            onChange={setStatus}
          />
        ) : null}

        {narrow ? null : (
          <SegmentedControl
            label="Priority"
            options={PRIORITY_FILTERS}
            value={priority}
            onChange={setPriority}
          />
        )}

        <div className="ml-auto flex shrink-0 items-center gap-[var(--space-2)]">
          {narrow ? null : (
            <>
              <IconButton title="List view" active={view === 'list'} onClick={() => setView('list')}>
                <List size={16} strokeWidth={1.5} />
              </IconButton>
              <IconButton
                title="Board view"
                active={view === 'board'}
                onClick={() => setView('board')}
              >
                <Columns3 size={16} strokeWidth={1.5} />
              </IconButton>
            </>
          )}

          {layout === 'wide' ? (
            <button
              type="button"
              onClick={() => setDensity(comfy ? 'dense' : 'comfy')}
              title="Toggle row density"
              className={cn(
                'h-[24px] rounded-xs border border-control px-[var(--space-2)]',
                'font-mono text-micro uppercase text-secondary hover:bg-hover hover:text-primary',
              )}
            >
              {comfy ? 'Comfy' : 'Dense'}
            </button>
          ) : null}

          <Button
            variant="primary"
            icon={<Plus size={14} strokeWidth={1.5} />}
            onClick={() => setCreating(true)}
          >
            {narrow ? 'New' : 'New task'}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[var(--shell-max-w)]">
          {tasks.isLoading ? <LoadingRows comfy={comfy} /> : null}

          {tasks.isError ? <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} /> : null}

          {tasks.isSuccess && rows.length === 0 ? (
            <EmptyState
              label={saved.id === 'all' ? 'No tasks' : `Nothing in ${saved.label.toLowerCase()}`}
              message={
                filtered
                  ? 'Nothing matched these filters. Widen them, or create a task.'
                  : saved.id === 'all'
                    ? 'Nothing here yet. Create a task, or ask the agent to.'
                    : 'Nothing is in this view right now.'
              }
              action={
                <Button variant="ghost" onClick={() => setCreating(true)}>
                  New task
                </Button>
              }
            />
          ) : null}

          {tasks.isSuccess && rows.length > 0 && (view === 'list' || narrow) ? (
            <>
              {narrow ? null : <ColumnHeaders comfy={comfy} showSchedule={showSchedule} />}
              <div>
                {rows.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    comfy={comfy}
                    stacked={narrow}
                    schedule={schedules.get(task.id) ?? null}
                    showSchedule={showSchedule}
                    showUpdated={layout !== 'medium'}
                    selected={task.id === openTask?.id}
                    onOpen={(candidate) => setOpenTask(candidate as Task)}
                  />
                ))}
              </div>
            </>
          ) : null}

          {tasks.isSuccess && rows.length > 0 && view === 'board' && !narrow ? (
            <Board tasks={rows} onOpen={(task) => setOpenTask(task as Task)} />
          ) : null}

          {tasks.data?.truncated ? (
            <p
              className={cn(
                'border-t border-divider px-[var(--task-row-pad-x)] py-[var(--space-3)]',
                'font-mono text-micro uppercase text-disabled',
              )}
            >
              Showing {rows.length} · more matched — narrow the filter
            </p>
          ) : null}

          {/* The console's bar sits over the bottom of this list on a phone. */}
          {narrow ? <div aria-hidden className="h-[56px]" /> : null}
        </div>
      </div>

      <TaskCreateForm open={creating} onOpenChange={setCreating} />
      <TaskDetailModal task={selected} onOpenChange={(open) => !open && setOpenTask(null)} />
    </div>
  );
}

/** Micro-labels over the columns, so a dense list still reads as a table. */
function ColumnHeaders({ comfy, showSchedule }: { comfy: boolean; showSchedule: boolean }) {
  return (
    <div
      className={cn(
        'sticky top-0 z-sticky flex items-center gap-[var(--task-row-gap)]',
        'border-b border-divider bg-app pr-[var(--task-row-pad-x)]',
        'h-[24px] font-mono text-micro uppercase text-disabled',
        comfy && 'h-[28px]',
      )}
    >
      {/* Mirrors TaskRow's column widths exactly. If one changes, both do. */}
      <span className="w-[var(--priority-rail-w)]" />
      <span className="ml-[var(--space-1)] w-[var(--task-col-status)]">Status</span>
      <span className="min-w-0 flex-1">Title</span>
      {showSchedule ? (
        <span className="w-[var(--task-col-sched)] text-right">Schedule</span>
      ) : null}
      <span className="w-[var(--task-col-due)] text-right">Due</span>
      <span className="hidden w-[var(--task-col-updated)] text-right xl:block">Updated</span>
    </div>
  );
}

function Board({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: AnyTask) => void }) {
  return (
    <div className="grid grid-cols-1 gap-[var(--space-4)] p-[var(--space-4)] md:grid-cols-3">
      {BOARD_COLUMNS.map((column) => {
        const columnTasks = tasks.filter((task) => task.status === column);

        return (
          <section key={column} className="flex flex-col gap-[var(--space-2)]">
            <header className="flex items-center justify-between border-b border-divider pb-[var(--space-2)]">
              <span className="font-mono text-micro uppercase text-muted">
                {STATUS_LABELS[column]}
              </span>
              <span className="font-mono text-micro text-disabled">{columnTasks.length}</span>
            </header>

            <div className="flex flex-col gap-[var(--space-2)]">
              {columnTasks.map((task) => (
                <TaskCard key={task.id} task={task} onOpen={onOpen} />
              ))}
              {columnTasks.length === 0 ? (
                <p className="py-[var(--space-4)] text-center font-mono text-micro uppercase text-disabled">
                  Empty
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}

function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 items-center overflow-hidden rounded-xs border border-control"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-[22px] px-[var(--space-2)] font-mono text-micro uppercase',
            'border-r border-hairline last:border-r-0',
            'transition-colors duration-[90ms] ease-sharp',
            option.value === value
              ? 'bg-selected text-primary'
              : 'text-muted hover:bg-hover hover:text-secondary',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
