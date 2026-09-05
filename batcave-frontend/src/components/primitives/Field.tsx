import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * Form controls.
 *
 * The label is a mono micro-label above a sunken well, which is the same
 * relationship the rest of the interface uses for "this is a named slot with a
 * value in it". Errors are prose, not mono: they are a sentence addressed to a
 * person, not a machine-readable field.
 */

const CONTROL = cn(
  'w-full rounded-xs bg-[var(--field-bg)] px-[var(--field-pad-x)]',
  'border border-[var(--field-border)] text-[var(--field-fg)]',
  'placeholder:text-[var(--field-placeholder)]',
  'transition-colors duration-[90ms] ease-sharp',
  'hover:border-strong focus:border-[var(--field-border-focus)]',
  'disabled:opacity-50',
);

interface LabelledProps {
  label: string;
  error?: string;
  hint?: string;
  children: (id: string, invalid: boolean) => ReactNode;
}

/** The shared frame: micro-label, control, then a hint or an error, never both. */
export function Labelled({ label, error, hint, children }: LabelledProps) {
  const id = useId();
  const invalid = Boolean(error);

  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <label
        htmlFor={id}
        className="font-mono text-micro uppercase text-muted select-none"
      >
        {label}
      </label>

      {children(id, invalid)}

      {error ? (
        <p className="text-body-sm font-prose text-danger">{error}</p>
      ) : hint ? (
        <p className="text-body-sm font-prose text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  error?: string;
  hint?: string;
}

export function TextField({ label, error, hint, className, ...props }: TextFieldProps) {
  return (
    <Labelled label={label} error={error} hint={hint}>
      {(id, invalid) => (
        <input
          id={id}
          aria-invalid={invalid}
          {...props}
          className={cn(
            CONTROL,
            'h-[var(--field-h)] font-prose text-body-sm',
            invalid && 'border-[var(--field-invalid-border)]',
            className,
          )}
        />
      )}
    </Labelled>
  );
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  error?: string;
  hint?: string;
}

export function TextAreaField({ label, error, hint, className, ...props }: TextAreaFieldProps) {
  return (
    <Labelled label={label} error={error} hint={hint}>
      {(id, invalid) => (
        <textarea
          id={id}
          aria-invalid={invalid}
          rows={4}
          {...props}
          className={cn(
            CONTROL,
            'py-[var(--space-2)] font-prose text-body-sm leading-[var(--lh-normal)] resize-y',
            invalid && 'border-[var(--field-invalid-border)]',
            className,
          )}
        />
      )}
    </Labelled>
  );
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  error?: string;
  hint?: string;
  options: Array<{ value: string; label: string }>;
}

/**
 * A native `<select>`, on purpose.
 *
 * The headless alternative would be a listbox, and the tokens are all in place
 * for one — but every select in this product picks between three fixed values
 * with no search, no multi-select and no custom rows. The native control is
 * keyboard-correct, screen-reader-correct and free on mobile, and swapping it
 * for a Radix listbox later touches only this file.
 */
export function SelectField({
  label,
  error,
  hint,
  options,
  className,
  ...props
}: SelectFieldProps) {
  return (
    <Labelled label={label} error={error} hint={hint}>
      {(id, invalid) => (
        <select
          id={id}
          aria-invalid={invalid}
          {...props}
          className={cn(
            CONTROL,
            'h-[var(--field-h)] cursor-pointer appearance-none',
            'font-mono text-mono-sm uppercase',
            invalid && 'border-[var(--field-invalid-border)]',
            className,
          )}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Labelled>
  );
}
