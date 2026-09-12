import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Empty and error states.
 *
 * Every list in this app renders one of these rather than nothing. An empty
 * grid with no explanation reads as a broken page, and "no results" without a
 * way forward is a dead end.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center',
        className,
      )}
    >
      {Icon && (
        <div className="mb-4 rounded-full bg-muted p-3">
          <Icon className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      <h2 className="font-serif text-lg font-semibold">{title}</h2>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/**
 * Error state.
 *
 * `digest` is Next.js's server-error correlation id. Showing it lets a
 * customer quote something specific to support without exposing a stack trace.
 */
export function ErrorState({
  title = 'Something went wrong',
  description = 'We could not load this just now. Please try again in a moment.',
  onRetry,
  digest,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  digest?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-16 text-center',
        className,
      )}
    >
      <h2 className="font-serif text-lg font-semibold">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 min-h-11 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Try again
        </button>
      )}

      {digest && (
        <p className="mt-4 font-mono text-xs text-muted-foreground">Reference: {digest}</p>
      )}
    </div>
  );
}
