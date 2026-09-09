import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Set by FormField so assistive tech announces the error state. */
  hasError?: boolean;
}

/**
 * Text input.
 *
 * `text-base` on mobile is deliberate: iOS Safari zooms the viewport whenever
 * a focused input has a font-size below 16px, which is jarring mid-checkout.
 * The 14px size is reintroduced from `sm:` upward.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', hasError, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      aria-invalid={hasError || undefined}
      className={cn(
        'flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2',
        'text-base shadow-sm transition-colors sm:text-sm',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        hasError && 'border-destructive focus-visible:ring-destructive',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { hasError?: boolean }
>(({ className, hasError, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={hasError || undefined}
    className={cn(
      'flex min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2',
      'text-base shadow-sm transition-colors sm:text-sm',
      'placeholder:text-muted-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      hasError && 'border-destructive focus-visible:ring-destructive',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Input, Textarea };
