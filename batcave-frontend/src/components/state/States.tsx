import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { ApiError, NetworkError } from '@/api/client';
import { cn } from '@/lib/cn';
import { Button } from '@/components/primitives/Button';

/**
 * Empty, loading, error and offline.
 *
 * These share a register: a mono micro-label saying what state the surface is
 * in, a prose sentence saying what that means, and — only where there is
 * genuinely something to do — one action. No illustrations, no apologies.
 */

interface EmptyStateProps {
  label: string;
  message: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ label, message, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-[var(--space-3)]',
        'px-[var(--space-6)] py-[var(--empty-pad)] text-center',
        className,
      )}
    >
      {/* A hairline rule above the label, so the empty region still reads as a
          plotted area of the interface rather than a hole in it. */}
      <div className="h-px w-[64px] bg-[var(--empty-rule)]" />
      <p className="font-mono text-micro uppercase text-muted">{label}</p>
      <p className="max-w-[42ch] font-prose text-body-sm text-[var(--empty-fg)]">{message}</p>
      {action}
    </div>
  );
}

/** Skeleton rows at the real row height, so nothing shifts when data lands. */
export function LoadingRows({ rows = 8, comfy = false }: { rows?: number; comfy?: boolean }) {
  return (
    <div aria-busy="true" aria-live="polite" className="motion-safe:animate-breathe">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn(
            'flex items-center gap-[var(--task-row-gap)] border-b border-hairline',
            'px-[var(--task-row-pad-x)]',
            comfy ? 'h-[var(--task-row-h-comfy)]' : 'h-[var(--task-row-h)]',
          )}
        >
          <div className="h-[21px] w-[var(--priority-rail-w)] bg-[var(--skeleton-bg)]" />
          <div className="h-[var(--pill-h)] w-[70px] bg-[var(--skeleton-bg)]" />
          <div
            className="h-[10px] flex-1 bg-[var(--skeleton-bg)]"
            style={{ maxWidth: `${38 + ((index * 17) % 44)}%` }}
          />
          <div className="h-[var(--due-chip-h)] w-[62px] bg-[var(--skeleton-bg)]" />
        </div>
      ))}
    </div>
  );
}

/**
 * An error, translated from the status the API actually returned.
 *
 * The distinctions that matter to a person: is this mine to fix, is it worth
 * trying again, and is the work I just did lost. 503 is the interesting case —
 * the turn is resumable, so the honest thing to say is that retrying continues
 * it rather than restarts it.
 */
export function describeError(error: unknown): { label: string; message: string; retryable: boolean } {
  if (error instanceof NetworkError) {
    return {
      label: 'Offline',
      message: 'Could not reach the API. Check the connection and try again.',
      retryable: true,
    };
  }

  if (error instanceof ApiError) {
    switch (error.status) {
      case 409:
        return {
          label: 'Conversation busy',
          message: 'Another turn is still running on this conversation.',
          retryable: true,
        };
      case 500:
        return {
          label: 'Server misconfigured',
          message: `${error.message}. This one needs fixing on the server.`,
          retryable: false,
        };
      case 502:
        return {
          label: 'Model unreachable',
          message: 'The model could not be reached. Retrying usually works.',
          retryable: true,
        };
      case 503:
        return {
          label: 'Database unreachable',
          message:
            'A tool could not reach the database. The turn is resumable — retrying continues it rather than starting over.',
          retryable: true,
        };
      case 504:
        return {
          label: 'Model timed out',
          message: 'The model took too long to answer. Try again.',
          retryable: true,
        };
      default:
        return { label: `Error ${error.status}`, message: error.message, retryable: false };
    }
  }

  return {
    label: 'Unexpected error',
    message: error instanceof Error ? error.message : 'Something went wrong.',
    retryable: true,
  };
}

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ error, onRetry, className }: ErrorStateProps) {
  const { label, message, retryable } = describeError(error);

  return (
    <EmptyState
      className={className}
      label={label}
      message={message}
      action={
        retryable && onRetry ? (
          <Button variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    />
  );
}

/** A compact inline banner, for errors inside a surface that still has content. */
export function ErrorBanner({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const { label, message, retryable } = describeError(error);

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-[var(--space-3)] border px-[var(--space-3)] py-[var(--space-2)]',
        'border-danger-border bg-danger-bg',
        className,
      )}
    >
      <AlertTriangle size={14} strokeWidth={1.5} className="mt-[3px] text-danger" />
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--space-1)]">
        <span className="font-mono text-micro uppercase text-danger">{label}</span>
        <span className="font-prose text-body-sm text-secondary">{message}</span>
      </div>
      {retryable && onRetry ? (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Offline banner.
 *
 * Driven by `navigator.onLine`, which is a coarse signal — it reports the link,
 * not whether the Worker is reachable. That is why an actual failed request
 * surfaces its own `NetworkError` separately: this bar is an early warning, not
 * the authority.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  useEffect(() => {
    const online = () => setOffline(false);
    const gone = () => setOffline(true);

    window.addEventListener('online', online);
    window.addEventListener('offline', gone);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', gone);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className={cn(
        'flex items-center justify-center gap-[var(--space-2)]',
        'border-b border-warning-border bg-warning-bg py-[var(--space-1)]',
        'font-mono text-micro uppercase text-warning',
      )}
    >
      <WifiOff size={14} strokeWidth={1.5} />
      Offline — showing cached data
    </div>
  );
}
