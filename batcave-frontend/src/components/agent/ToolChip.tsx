import type { AgentAction } from '@/api/types';
import { cn } from '@/lib/cn';

/**
 * One tool invocation, rendered as a chip.
 *
 * Subordinate to prose by construction: indented, 22px tall, mono, muted, and
 * never wider than the prose column. The transcript is a narrative and the tool
 * calls are its stage directions — they have to be readable without competing
 * with what the agent actually said.
 *
 * What a chip can honestly show is limited by the wire: `AgentAction` carries
 * the tool name and the result, but not the arguments the model passed. So the
 * chip reports *what ran and how it went*, never *what it was asked* — inventing
 * a plausible-looking argument summary would be fiction.
 */

const OUTCOME = {
  ok: 'text-agent-ok border-agent-ok-border bg-agent-ok-bg',
  fail: 'text-agent-fail border-agent-fail-border bg-agent-fail-bg',
} as const;

/** What the action produced, in as few characters as will carry it. */
function resultOf(action: AgentAction): string {
  if (!action.ok) return 'FAILED';

  if (action.schedule) {
    return action.schedule.status === 'cancelled' ? 'CANCELLED' : 'SCHEDULED';
  }

  if (action.tasks) {
    const count = action.tasks.length;
    return count === 1 ? '1 RESULT' : `${count} RESULTS`;
  }

  if (action.task) return action.tool === 'create_task' ? 'CREATED' : 'UPDATED';

  return 'OK';
}

export function ToolChip({ action }: { action: AgentAction }) {
  const failed = !action.ok;

  return (
    <div
      className={cn(
        'inline-flex h-[var(--toolchip-h)] items-center gap-[var(--space-2)]',
        'rounded-xs border px-[var(--toolchip-pad-x)]',
        'font-mono text-mono-sm uppercase',
        failed ? OUTCOME.fail : 'border-[var(--toolchip-border)] bg-[var(--toolchip-bg)]',
      )}
    >
      <span aria-hidden className={failed ? 'text-agent-fail' : 'text-agent-ok'}>
        {failed ? '✗' : '▸'}
      </span>

      <span className={failed ? 'text-agent-fail' : 'text-[var(--toolchip-fg)]'}>
        {action.tool}
      </span>

      <span aria-hidden className="text-disabled">
        ·
      </span>

      <span className={failed ? 'text-agent-fail' : 'text-agent-ok'}>{resultOf(action)}</span>
    </div>
  );
}

/** The error text a failed tool came back with, when there is one to show. */
export function ToolError({ action }: { action: AgentAction }) {
  if (action.ok || action.error == null) return null;

  const message = typeof action.error === 'string' ? action.error : JSON.stringify(action.error);

  return (
    <p
      className={cn(
        'ml-[var(--toolchip-indent)] max-w-[var(--msg-max-w)]',
        'font-mono text-mono-md text-agent-fail',
      )}
    >
      {message}
    </p>
  );
}
