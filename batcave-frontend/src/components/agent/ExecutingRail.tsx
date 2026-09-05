import { cn } from '@/lib/cn';

/**
 * A turn is in flight.
 *
 * This is the one sustained animation in the product, and it is justified: a
 * Groq round trip with up to five tool rounds genuinely takes seconds, and the
 * user is owed evidence that something is happening rather than a frozen pane.
 *
 * It is deliberately *indeterminate*. The API answers a whole turn in one
 * response, so nothing here knows which tool is running or how many rounds are
 * left. A progress bar with a percentage, or a sequence of fake per-tool chips,
 * would be an invention — and inventing detail is precisely how a console stops
 * being trustworthy. The honest signal is "executing", so that is what it says.
 *
 * Under `prefers-reduced-motion` the sweep is replaced by a static filled rail
 * (see base.css); the label carries the meaning either way.
 */

export function ExecutingRail({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex flex-col gap-[var(--space-2)]', className)}
    >
      <span className="ml-[var(--toolchip-indent)] font-mono text-micro uppercase text-agent-executing">
        Executing
      </span>

      <div
        aria-hidden
        className={cn(
          'ml-[var(--toolchip-indent)] max-w-[var(--msg-max-w)] overflow-hidden',
          'h-[var(--executing-rail-h)] bg-[var(--executing-rail-track)]',
        )}
      >
        <div
          className={cn(
            'executing-rail__fill h-full w-[30%]',
            'bg-[var(--executing-rail-fill)]',
            'motion-safe:animate-sweep',
          )}
        />
      </div>
    </div>
  );
}

/**
 * The boundary between conversation that was replayed from the checkpoint and
 * conversation that happened in this page load.
 *
 * History survives across requests and reloads, which is a genuine feature and
 * also a small disorientation: a page that opens mid-conversation should say so
 * rather than pretend the user has been here all along.
 */
export function SessionBoundary({ turns }: { turns: number }) {
  return (
    <div className="flex items-center gap-[var(--space-3)]" role="separator">
      <span className="h-px flex-1 bg-hairline" />
      <span className="font-mono text-micro uppercase text-muted">
        Session resumed · {turns} {turns === 1 ? 'turn' : 'turns'}
      </span>
      <span className="h-px flex-1 bg-hairline" />
    </div>
  );
}
