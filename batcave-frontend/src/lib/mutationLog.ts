import { useCallback, useSyncExternalStore } from 'react';
import type { AgentAction, Task } from '@/api/types';

/**
 * Which records the agent changed, and how recently.
 *
 * The point of this store is a single interaction: the agent can rewrite a task
 * the user is looking at in the index or has open in a modal. A record that
 * changes underneath someone with no acknowledgment is how a tool loses trust,
 * so every mutation an agent turn reports is logged here and the affected row
 * says so.
 *
 * Two tiers of acknowledgment, by design:
 *
 *   flash    a one-shot register animation, for a row that is on screen now
 *   marked   a persistent rail, for a row the user has not looked at yet
 *
 * The flash expires on a timer. The mark does not — it is cleared when the user
 * actually engages with the row, because "I have seen this" is an action, not
 * the passage of time.
 */

/** How long the transient `↑ UPDATED` marker stays up. */
export const FLASH_MS = 6000;

interface Entry {
  at: number;
  /** Cleared by `acknowledge`, not by the clock. */
  seen: boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Records every task an agent turn touched.
 *
 * Only `create_task` and `update_task` carry a `task`; a search returns records
 * without changing them and must not be logged, or every list the agent shows
 * would light the whole index up.
 */
export function recordActions(actions: AgentAction[]): Task[] {
  const changed: Task[] = [];

  for (const action of actions) {
    if (!action.ok || !action.task) continue;
    entries.set(action.task.id, { at: Date.now(), seen: false });
    changed.push(action.task);
  }

  if (changed.length > 0) emit();
  return changed;
}

/** The user has engaged with this record; stop flagging it. */
export function acknowledge(taskId: string): void {
  if (entries.delete(taskId)) emit();
}

export function clearAll(): void {
  if (entries.size === 0) return;
  entries.clear();
  emit();
}

export type MutationState = 'none' | 'flash' | 'marked';

function stateOf(taskId: string, now: number): MutationState {
  const entry = entries.get(taskId);
  if (!entry || entry.seen) return 'none';
  return now - entry.at < FLASH_MS ? 'flash' : 'marked';
}

/**
 * Subscribes a row to its own mutation state.
 *
 * The timer is per-row rather than global: only a row that is actually
 * flashing schedules anything, and it schedules exactly one transition, at the
 * moment its own flash expires. Nothing polls.
 *
 * `subscribe` is memoised on the task id so React does not tear the
 * subscription down and rebuild it on every render, and the timer is re-armed
 * from inside the listener — a second mutation on the same row while its first
 * flash is still up has to restart the clock, and re-arming on emit is what
 * makes that happen without re-subscribing.
 */
export function useMutationState(taskId: string): MutationState {
  const subscribeToTask = useCallback(
    (onChange: () => void) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const arm = () => {
        clearTimeout(timer);
        const entry = entries.get(taskId);
        if (!entry || entry.seen) return;

        const remaining = FLASH_MS - (Date.now() - entry.at);
        if (remaining > 0) timer = setTimeout(onChange, remaining);
      };

      const unsubscribe = subscribe(() => {
        arm();
        onChange();
      });

      arm();

      return () => {
        clearTimeout(timer);
        unsubscribe();
      };
    },
    [taskId],
  );

  return useSyncExternalStore(
    subscribeToTask,
    () => stateOf(taskId, Date.now()),
    () => 'none' as const,
  );
}
