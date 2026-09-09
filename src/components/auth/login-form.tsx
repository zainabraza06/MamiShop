'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { Separator } from '@/components/ui/separator';
import { safeRedirectPath } from '@/lib/utils';

/**
 * Sign-in form.
 *
 * One error message covers every credential failure — unknown email, wrong
 * password, or a locked account. The server already equalises the timing of
 * those cases; showing different messages here would undo that and let the
 * form be used to test whether an address has an account.
 *
 * The exception is a suspended account, which the middleware reports
 * explicitly: that user needs to know to contact support rather than keep
 * retrying a password that is, in fact, correct.
 */

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: 'Those details do not match an account. Please check and try again.',
  AccountSuspended: 'This account has been suspended. Please contact support.',
  OAuthAccountNotLinked:
    'That email is already registered with a password. Sign in with your password instead.',
  Configuration: 'Sign-in is temporarily unavailable. Please try again shortly.',
};

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Never trust a callbackUrl from the query string without checking it: an
  // absolute or protocol-relative value would make this an open redirect.
  const callbackUrl = safeRedirectPath(searchParams.get('callbackUrl'), '/account');
  const urlError = searchParams.get('error');

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(
    urlError ? (ERROR_MESSAGES[urlError] ?? ERROR_MESSAGES.CredentialsSignin) : null,
  );
  const [isPending, setIsPending] = React.useState(false);
  const [isGooglePending, setIsGooglePending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (!result || result.error) {
        setError(ERROR_MESSAGES.CredentialsSignin);
        return;
      }

      // refresh() before push() so the server components behind the
      // destination re-render with the new session rather than the cached
      // signed-out shell.
      router.refresh();
      router.push(callbackUrl);
    } catch {
      setError('We could not sign you in just now. Please try again.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField label="Email" id="login-email" required>
          <Input
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>

        <div>
          <FormField label="Password" id="login-password" required>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          <p className="mt-2 text-end">
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Forgot your password?
            </Link>
          </p>
        </div>

        <Button type="submit" fullWidth size="lg" isLoading={isPending} loadingText="Signing in">
          Sign in
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      <Button
        type="button"
        variant="outline"
        fullWidth
        size="lg"
        isLoading={isGooglePending}
        onClick={() => {
          setIsGooglePending(true);
          // A full redirect, unlike the credentials flow — the OAuth round trip
          // has to leave the page.
          void signIn('google', { callbackUrl });
        }}
      >
        <GoogleIcon />
        Continue with Google
      </Button>
    </div>
  );
}

/** Google's mark. Decorative — the button already has a text label. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5a11 11 0 0 0-9.82 6.05l3.66 2.84c.87-2.6 3.3-4.64 6.16-4.64Z"
      />
    </svg>
  );
}
