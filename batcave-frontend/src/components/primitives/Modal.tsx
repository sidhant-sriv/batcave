import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './Button';

/**
 * Modal shell over Radix Dialog.
 *
 * Radix supplies the behaviour — focus trap, scroll lock, escape, aria wiring,
 * portal — and none of it is styled through overrides: every visual decision
 * here is a token. That is the whole reason for a headless primitive.
 *
 * The corner ticks are one of only three places the register mark appears. A
 * modal is the most "record-like" surface in the product, so it earns one.
 */

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Mono metadata rendered beside the title: ids, timestamps, status. */
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** A banner between the header and the body — used for the agent-changed notice. */
  banner?: ReactNode;
}

export function Modal({
  open,
  onOpenChange,
  title,
  meta,
  children,
  footer,
  banner,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-scrim bg-scrim',
            'motion-safe:animate-[reveal_var(--dur-3)_var(--ease-reveal)]',
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-modal w-[min(var(--modal-w),calc(100vw-var(--space-8)))]',
            '-translate-x-1/2 -translate-y-1/2',
            'max-h-[calc(100vh-var(--space-16))] overflow-y-auto',
            'rounded-sm border border-[var(--modal-border)] bg-[var(--modal-bg)]',
            'ticked',
            'motion-safe:animate-[reveal_var(--dur-3)_var(--ease-reveal)]',
          )}
        >
          <header
            className={cn(
              'flex items-start justify-between gap-[var(--space-4)]',
              'border-b border-hairline px-[var(--modal-pad)] py-[var(--space-4)]',
            )}
          >
            <div className="flex min-w-0 flex-col gap-[var(--space-2)]">
              <Dialog.Title className="font-prose text-title text-primary">{title}</Dialog.Title>
              {meta ? (
                <div className="flex flex-wrap items-center gap-[var(--space-3)] font-mono text-micro uppercase text-muted">
                  {meta}
                </div>
              ) : null}
            </div>

            <Dialog.Close asChild>
              <IconButton title="Close">
                <X size={16} strokeWidth={1.5} />
              </IconButton>
            </Dialog.Close>
          </header>

          {banner}

          <div className="px-[var(--modal-pad)] py-[var(--space-5)]">{children}</div>

          {footer ? (
            <footer
              className={cn(
                'flex items-center justify-end gap-[var(--space-2)]',
                'border-t border-hairline px-[var(--modal-pad)] py-[var(--space-4)]',
              )}
            >
              {footer}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  /** Shown in place of the description when the action was refused. */
  error?: string | null;
}

/** A confirmation with one destructive action. Used only by chat deletion. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
  error,
}: ConfirmProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-scrim bg-scrim" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-modal w-[min(420px,calc(100vw-var(--space-8)))]',
            '-translate-x-1/2 -translate-y-1/2',
            'rounded-sm border border-[var(--modal-border)] bg-[var(--modal-bg)] p-[var(--space-6)]',
            'flex flex-col gap-[var(--space-4)]',
            'motion-safe:animate-[reveal_var(--dur-3)_var(--ease-reveal)]',
          )}
        >
          <Dialog.Title className="font-mono text-micro uppercase text-muted">
            {title}
          </Dialog.Title>

          <Dialog.Description
            className={cn('font-prose text-body-sm', error ? 'text-danger' : 'text-primary')}
          >
            {error ?? description}
          </Dialog.Description>

          <div className="flex justify-end gap-[var(--space-2)]">
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn(
                  'h-[var(--btn-h)] rounded-xs border border-[var(--btn-ghost-border)]',
                  'px-[var(--btn-pad-x)] font-mono text-micro uppercase text-secondary',
                  'hover:bg-hover hover:text-primary',
                )}
              >
                Cancel
              </button>
            </Dialog.Close>

            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className={cn(
                'h-[var(--btn-h)] rounded-xs border border-[var(--btn-danger-border)]',
                'px-[var(--btn-pad-x)] font-mono text-micro uppercase text-danger',
                'hover:bg-[var(--btn-danger-bg-hover)]',
                'disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              {pending ? 'Working' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
