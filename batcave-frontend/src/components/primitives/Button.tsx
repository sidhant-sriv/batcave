import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Three variants, and the restraint is the point:
 *
 *   primary  the accent. One per surface, at most — it is one of the five
 *            places the accent is allowed to appear at all.
 *   ghost    everything else. A hairline box that fills on hover.
 *   danger   destructive confirmation only, never a resting affordance.
 *
 * Labels are uppercase mono micro-type, which is what keeps a button reading as
 * a control on an instrument rather than a call to action on a landing page.
 */

type Variant = 'primary' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] ' +
    'hover:bg-[var(--btn-primary-bg-hover)] active:bg-[var(--btn-primary-bg-active)]',
  ghost:
    'bg-[var(--btn-ghost-bg)] text-[var(--btn-ghost-fg)] ' +
    'border border-[var(--btn-ghost-border)] hover:bg-[var(--btn-ghost-bg-hover)] ' +
    'hover:text-primary',
  danger:
    'bg-[var(--btn-danger-bg)] text-[var(--btn-danger-fg)] ' +
    'border border-[var(--btn-danger-border)] hover:bg-[var(--btn-danger-bg-hover)]',
};

export function Button({
  variant = 'ghost',
  size = 'md',
  icon,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-[6px] whitespace-nowrap',
        'rounded-xs font-mono text-micro uppercase',
        'transition-colors duration-[90ms] ease-sharp',
        'disabled:opacity-40 disabled:pointer-events-none',
        size === 'md'
          ? 'h-[var(--btn-h)] px-[var(--btn-pad-x)]'
          : 'h-[var(--btn-h-sm)] px-[var(--space-2)]',
        VARIANTS[variant],
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * A square control that carries only an icon. `title` is required rather than
 * optional: an icon with no accessible name is not a button, it is a rebus.
 */
interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  children: ReactNode;
  active?: boolean;
}

export function IconButton({ title, active, className, children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      {...props}
      className={cn(
        'inline-flex size-[26px] items-center justify-center rounded-xs',
        'text-muted transition-colors duration-[90ms] ease-sharp',
        'hover:bg-hover hover:text-primary',
        'disabled:opacity-40 disabled:pointer-events-none',
        active && 'bg-selected text-primary',
        className,
      )}
    >
      {children}
    </button>
  );
}
