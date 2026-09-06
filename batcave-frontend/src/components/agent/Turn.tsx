import type { AnyTask, ChatTurn } from '@/api/types';
import { cn } from '@/lib/cn';
import { disambiguationOf } from '@/lib/disambiguation';
import { renderInlineMarkdown } from '@/lib/inlineMarkdown';
import { ordinalLabel, ordinalPhrase } from '@/lib/ordinals';
import { TaskRow } from '@/components/task/TaskRow';
import { ScheduleResultBlock } from './ScheduleResultBlock';
import { ToolChip, ToolError } from './ToolChip';
import { ToolResultBlock } from './ToolResultBlock';

/**
 * One exchange, rendered.
 *
 * Replayed history and a live answer come off the wire in the same shape, so
 * they render through this one component. That is a deliberate gift from the
 * backend and it would be a waste to build two paths.
 *
 * The transcript/record distinction is carried here:
 *
 *   transcript  the user's message and the agent's prose — no border, sitting
 *               directly on the app background, narrative and chronological
 *   record      anything that came out of D1 — a raised, bordered, corner-ticked
 *               panel, precise and referenceable
 */

interface Props {
  turn: ChatTurn;
  onOpenTask?: (task: AnyTask) => void;
  /** Sending is disabled while a turn is in flight, so this may be absent. */
  onChoose?: (message: string) => void;
}

export function Turn({ turn, onOpenTask, onChoose }: Props) {
  const disambiguation = disambiguationOf(turn);

  return (
    <article className="flex flex-col gap-[var(--space-3)]">
      <UserMessage text={turn.message} />

      {/* Tool activity, subordinate to the prose it sits above. When the turn is
          a disambiguation, the results are rendered by the prompt below instead,
          so they are not shown twice. */}
      {turn.actions.length > 0 ? (
        <div className="flex flex-col gap-[var(--space-2)]">
          {turn.actions.map((action, index) => (
            <div key={index} className="flex flex-col gap-[var(--space-2)]">
              <div className="ml-[var(--toolchip-indent)]">
                <ToolChip action={action} />
              </div>
              <ToolError action={action} />
              {!disambiguation ? (
                <>
                  <ToolResultBlock action={action} onOpenTask={onOpenTask} />
                  <ScheduleResultBlock action={action} onOpenTask={onOpenTask} />
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {disambiguation ? (
        <DisambiguationPrompt
          prompt={disambiguation.prompt}
          candidates={disambiguation.candidates}
          onChoose={onChoose}
        />
      ) : turn.reply ? (
        <AgentMessage text={turn.reply} />
      ) : null}
    </article>
  );
}

/** The user's own words. An accent rail marks it as theirs. */
export function UserMessage({ text }: { text: string }) {
  return (
    <div
      className={cn(
        'max-w-[var(--msg-max-w)] self-start',
        'border-l-[var(--msg-user-rail-w)] border-[var(--msg-user-rail)]',
        'bg-[var(--msg-user-bg)] px-[var(--msg-user-pad)] py-[var(--space-2)]',
        'font-prose text-body text-primary whitespace-pre-wrap',
      )}
    >
      {text}
    </div>
  );
}

/**
 * The agent's prose. No border, no ground — it floats on the substrate.
 *
 * `pre-wrap` carries the model's own line breaks, which is what makes its
 * numbered lists render as lists without a block-level markdown parser. Inline
 * emphasis is resolved so `**` never reaches the reader.
 */
export function AgentMessage({ text }: { text: string }) {
  return (
    <div
      className={cn(
        'max-w-[var(--msg-max-w)] font-prose text-body',
        'text-[var(--msg-agent-fg)] whitespace-pre-wrap',
      )}
    >
      {renderInlineMarkdown(text)}
    </div>
  );
}

/**
 * The agent refused to guess.
 *
 * Amber, never red: being asked to choose is not an error, it is the agent
 * behaving correctly. The state reads as *blocked, awaiting your call*.
 *
 * Each candidate is clickable and sends the ordinal phrase the agent's own
 * prompt taught it to resolve, so the choice lands in the conversation as a
 * normal message rather than as a special protocol.
 */
interface DisambiguationProps {
  prompt: string;
  candidates: AnyTask[];
  onChoose?: (message: string) => void;
}

export function DisambiguationPrompt({ prompt, candidates, onChoose }: DisambiguationProps) {
  return (
    <div
      className={cn(
        'ticked max-w-[var(--msg-max-w)]',
        'border border-[var(--disambig-border)]',
        'border-l-[var(--disambig-rail-w)] bg-[var(--disambig-bg)]',
      )}
    >
      <header
        className={cn(
          'flex items-center gap-[var(--space-2)] border-b border-[var(--disambig-border)]',
          'px-[var(--space-3)] py-[var(--space-1)]',
          'font-mono text-micro uppercase text-agent-awaiting',
        )}
      >
        Awaiting your choice
      </header>

      <p className="px-[var(--space-3)] py-[var(--space-3)] font-prose text-body text-primary">
        {renderInlineMarkdown(prompt)}
      </p>

      <ol className="border-t border-[var(--disambig-border)]">
        {candidates.map((task, index) => (
          <li key={task.id} className="flex items-stretch">
            <span
              aria-hidden
              className={cn(
                'flex w-[var(--toolresult-ordinal-w)] shrink-0 items-center justify-center',
                'border-b border-r border-[var(--disambig-border)]',
                'font-mono text-mono-sm text-agent-awaiting',
              )}
            >
              {ordinalLabel(index)}
            </span>

            <button
              type="button"
              disabled={!onChoose}
              onClick={() => onChoose?.(ordinalPhrase(index))}
              className={cn(
                'min-w-0 flex-1 text-left hover:bg-hover',
                'disabled:pointer-events-none disabled:opacity-60',
              )}
            >
              <TaskRow task={task} showUpdated={false} historical className="pointer-events-none" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
