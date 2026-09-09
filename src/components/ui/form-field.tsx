'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Accessible field wrapper.
 *
 * Wires up the four things a form control needs and that hand-rolled markup
 * almost always gets partly wrong:
 *
 *   - `htmlFor`/`id` so clicking the label focuses the control
 *   - `aria-describedby` pointing at BOTH the hint and the error, so a screen
 *     reader reads the requirement and the failure, not just one
 *   - `aria-invalid` on the control itself
 *   - `role="alert"` on the error so it is announced when it appears, without
 *     the user having to navigate back to the field
 *
 * The child is cloned rather than rendered through a render-prop so callers
 * can write the natural `<FormField><Input /></FormField>`.
 */
export interface FormFieldProps {
  label: string;
  /** Stable id; one is derived if omitted. */
  id?: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  /** Renders the label for screen readers only (e.g. a search box with a placeholder). */
  hideLabel?: boolean;
  children: React.ReactElement;
}

export function FormField({
  label,
  id,
  hint,
  error,
  required,
  className,
  hideLabel,
  children,
}: FormFieldProps) {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const control = React.cloneElement(
    children as React.ReactElement<Record<string, unknown>>,
    {
      id: fieldId,
      'aria-describedby': describedBy,
      'aria-invalid': error ? true : undefined,
      'aria-required': required || undefined,
      hasError: Boolean(error),
    },
  );

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={fieldId} required={required} className={cn(hideLabel && 'sr-only')}>
        {label}
      </Label>

      {control}

      {hint && !error && (
        <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-xs font-medium text-destructive"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Summary of every error in a form, rendered above the submit button.
 *
 * On a long form (checkout, the measurement sheet) an inline error can be far
 * off-screen. This gives one focusable list of links straight to the offending
 * fields, which is the pattern WCAG 3.3.1 is really asking for.
 */
export function FormErrorSummary({
  errors,
  title = 'Please fix the following before continuing',
}: {
  errors: { field: string; message: string }[];
  title?: string;
}) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  // Move focus to the summary when it appears, so the user is told immediately
  // rather than discovering the failure by re-reading the form.
  React.useEffect(() => {
    if (errors.length > 0) headingRef.current?.focus();
  }, [errors.length]);

  if (errors.length === 0) return null;

  return (
    <div
      role="alert"
      aria-labelledby="form-error-summary-title"
      className="rounded-md border border-destructive/40 bg-destructive/5 p-4"
    >
      <h2
        id="form-error-summary-title"
        ref={headingRef}
        tabIndex={-1}
        className="flex items-center gap-2 text-sm font-semibold text-destructive outline-none"
      >
        <AlertCircle className="size-4" aria-hidden="true" />
        {title}
      </h2>
      <ul className="mt-2 space-y-1 ps-6 text-sm text-destructive">
        {errors.map((error) => (
          <li key={error.field}>
            <a href={`#${error.field}`} className="underline underline-offset-2">
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
