'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Signs the customer out and returns them to the shop.
 *
 * Best effort: even if the request fails, the page moves on and refreshes, so
 * nobody is left looking at an account the session may no longer back. The
 * shopping assistant's conversation is cleared too, since on a shared phone
 * the next person should not read it.
 */
export function SignOutButton({
  className,
  onSignedOut,
}: {
  className?: string;
  onSignedOut?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        try {
          window.sessionStorage.removeItem('momishop.assistant');
        } catch {
          // Storage blocked: nothing was saved there to clear.
        }
        void fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
          onSignedOut?.();
          router.replace('/');
          router.refresh();
        });
      }}
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
        className,
      )}
    >
      <LogOut className="size-4" aria-hidden="true" />
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
