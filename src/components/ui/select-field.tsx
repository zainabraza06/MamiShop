'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * A labelled Radix Select.
 *
 * `FormField` cannot be used for a Select, and the failure is silent, which is
 * why this exists. FormField attaches the id by cloning its child; Radix's
 * `<Select>` root renders **no DOM element at all**, so the id evaporates and
 * the combobox ends up with no accessible name. Nothing throws, nothing warns,
 * and the field looks perfectly fine on screen — it is simply unusable with a
 * screen reader.
 *
 * Here the id goes on `SelectTrigger`, which is the button the user actually
 * focuses, so `<label for>` has something real to point at.
 */
export interface SelectFieldOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectFieldOption[] | readonly string[];
  id?: string;
  placeholder?: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** Renders the label for screen readers only. */
  hideLabel?: boolean;
}

export function SelectField({
  label,
  value,
  onValueChange,
  options,
  id,
  placeholder,
  hint,
  error,
  required,
  disabled,
  className,
  hideLabel,
}: SelectFieldProps) {
  const generatedId = React.useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const normalised: SelectFieldOption[] = options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  );

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={fieldId} required={required} className={cn(hideLabel && 'sr-only')}>
        {label}
      </Label>

      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={fieldId}
          hasError={Boolean(error)}
          aria-describedby={describedBy}
          aria-required={required || undefined}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>

        <SelectContent>
          {normalised.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
