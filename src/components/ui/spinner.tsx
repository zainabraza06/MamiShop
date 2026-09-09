import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Busy indicator.
 *
 * `role="status"` with a visually hidden label announces the wait once.
 * Without the label a screen reader reports nothing at all.
 */
export function Spinner({
  className,
  label = 'Loading',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="size-8 text-muted-foreground" label={label} />
    </div>
  );
}
