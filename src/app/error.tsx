'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';

/**
 * Root error boundary.
 *
 * Shows the Next.js `digest` — a correlation id for the server-side error — so
 * a customer can quote something specific to support without us exposing a
 * stack trace. The real error is already in the structured logs and Sentry.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surfaced to Sentry through its global handler; logged here too so a
    // local reproduction is visible without opening the dashboard.
    console.error('Unhandled application error', error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="text-display font-semibold">Something went wrong</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        We hit an unexpected problem. Trying again often works — if it does not, please contact us
        and quote the reference below.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
        <Button size="lg" variant="outline" asChild>
          {/*
            A plain anchor rather than next/link, deliberately. This boundary
            catches errors that may have left the client router in a bad state;
            a soft navigation would reuse it. A full document load throws away
            the broken state entirely, which is the whole point of the escape
            hatch.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/">Go home</a>
        </Button>
      </div>

      {error.digest && (
        <p className="mt-6 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
      )}
    </div>
  );
}
