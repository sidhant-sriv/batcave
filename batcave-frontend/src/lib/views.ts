import type { Task, TaskFilters } from '@/api/types';
import { TASK_LIMIT_MAX } from '@/api/tasks';
import { todayUtc } from './dueDate';

/**
 * Saved views.
 *
 * A view is two things that must agree: a server-side filter that fetches it,
 * and a client-side predicate that counts it in the navigator. They are defined
 * side by side here so they cannot drift — a badge that says 3 beside a list
 * showing 5 is worse than no badge at all.
 *
 * "Due today" and "Overdue" deliberately exclude finished work. `dueBucket`
 * treats a done task due today as still "today" because a chip on a row should
 * state the date's own relationship to now; a view called Due today is instead
 * answering "what do I have to do", and a finished task is not that.
 */

export type ViewId = 'all' | 'active' | 'today' | 'overdue' | 'done';

export interface View {
  id: ViewId;
  label: string;
  /** What the index asks the API for. */
  filters: (today: string) => TaskFilters;
  /** How the navigator counts it, from the unfiltered list it already holds. */
  matches: (task: Task, today: string) => boolean;
}

const OPEN = ['todo', 'in_progress'] as const;

export const VIEWS: View[] = [
  {
    id: 'all',
    label: 'All tasks',
    filters: () => ({}),
    matches: () => true,
  },
  {
    id: 'active',
    label: 'Active',
    filters: () => ({ status: ['in_progress'] }),
    matches: (task) => task.status === 'in_progress',
  },
  {
    id: 'today',
    label: 'Due today',
    filters: (today) => ({ status: [...OPEN], due_from: today, due_to: today }),
    matches: (task, today) => task.due_date === today && task.status !== 'done',
  },
  {
    id: 'overdue',
    label: 'Overdue',
    // `due_to` is exclusive of today by being yesterday, which is the same
    // boundary `dueBucket` draws — one day either side and the two disagree.
    filters: (today) => ({ status: [...OPEN], due_to: dayBefore(today) }),
    matches: (task, today) =>
      task.due_date !== null && task.due_date < today && task.status !== 'done',
  },
  {
    id: 'done',
    label: 'Done',
    filters: () => ({ status: ['done'] }),
    matches: (task) => task.status === 'done',
  },
];

export const DEFAULT_VIEW: ViewId = 'all';

export function viewOf(id: string | null): View {
  return VIEWS.find((view) => view.id === id) ?? VIEWS[0]!;
}

/** `2026-09-05` becomes `2026-09-04`. */
export function dayBefore(date: string): string {
  const at = Date.parse(`${date}T00:00:00Z`) - 86_400_000;
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * The query key for the whole, unfiltered list.
 *
 * The navigator counts from this one response rather than issuing a request per
 * view, and the index asks for the identical shape when the view is All with no
 * filters — so opening the default surface costs no second read.
 */
export const ALL_TASKS_FILTERS: TaskFilters = { limit: TASK_LIMIT_MAX };

export function countsOf(tasks: Task[], today: string = todayUtc()): Record<ViewId, number> {
  const counts = { all: 0, active: 0, today: 0, overdue: 0, done: 0 } as Record<ViewId, number>;

  for (const task of tasks) {
    for (const view of VIEWS) {
      if (view.matches(task, today)) counts[view.id] += 1;
    }
  }

  return counts;
}
