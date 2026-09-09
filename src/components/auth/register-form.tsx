'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField, FormErrorSummary } from '@/components/ui/form-field';
import { assessPasswordStrength } from '@/lib/password';
import { cn } from '@/lib/utils';

/**
 * Registration.
 *
 * Password strength is assessed with the same function the server uses, and
 * shown as live guidance rather than a blocking error while typing. The bar is
 * length-first: a long passphrase beats a short string of symbol
 * substitutions, and complexity rules mostly teach people to write P@ssw0rd.
 *
 * On success the form signs the user straight in. Making someone who just
 * chose a password immediately type it again is friction with no security
 * benefit.
 */
export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const referralFromUrl = searchParams.get('ref') ?? '';

  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [marketingOptIn, setMarketingOptIn] = React.useState(false);
  const [acceptTerms, setAcceptTerms] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);
  const [errors, setErrors] = React.useState<{ field: string; message: string }[]>([]);

  const strength = React.useMemo(
    () => (password ? assessPasswordStrength(password) : null),
    [password],
  );

  function validate() {
    const found: { field: string; message: string }[] = [];
    if (name.trim().length < 2) found.push({ field: 'name', message: 'Enter your name.' });
    if (!email.includes('@'))
      found.push({ field: 'email', message: 'Enter a valid email address.' });
    if (password.length < 10)
      found.push({ field: 'password', message: 'Use at least 10 characters.' });
    if (password !== confirmPassword)
      found.push({ field: 'confirmPassword', message: 'Passwords do not match.' });
    if (!acceptTerms)
      found.push({ field: 'acceptTerms', message: 'Please accept the terms to continue.' });
    return found;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const found = validate();
    setErrors(found);
    if (found.length > 0) return;

    setIsPending(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone: phone || undefined,
          password,
          confirmPassword,
          marketingOptIn,
          referralCode: referralFromUrl || undefined,
          acceptTerms: true,
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        error?: string;
        issues?: { field: string; message: string }[];
      } | null;

      if (!response.ok) {
        if (body?.issues) setErrors(body.issues);
        throw new Error(body?.error ?? 'We could not create your account.');
      }

      /**
       * The register endpoint responds identically for a new and an existing
       * email, so this sign-in attempt is what actually distinguishes them —
       * and it does so only for someone who already knows the password.
       */
      const result = await signIn('credentials', { email, password, redirect: false });

      if (result && !result.error) {
        router.refresh();
        router.push('/account');
        return;
      }

      toast.success('Check your email to finish setting up your account.');
      router.push('/login');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'We could not create your account.',
      );
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormErrorSummary errors={errors} />

      <FormField
        label="Name"
        id="name"
        required
        error={errors.find((e) => e.field === 'name')?.message}
      >
        <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>

      <FormField
        label="Email"
        id="email"
        required
        error={errors.find((e) => e.field === 'email')?.message}
      >
        <Input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </FormField>

      <FormField
        label="Mobile number (optional)"
        id="phone"
        hint="For delivery updates by SMS."
      >
        <Input
          type="tel"
          autoComplete="tel"
          placeholder="0300 1234567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </FormField>

      <div>
        <FormField
          label="Password"
          id="password"
          required
          error={errors.find((e) => e.field === 'password')?.message}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>

        {strength && (
          <div className="mt-2">
            <div
              role="progressbar"
              aria-valuenow={strength.score}
              aria-valuemin={0}
              aria-valuemax={4}
              aria-label="Password strength"
              className="flex gap-1"
            >
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-colors',
                    i < strength.score
                      ? strength.score <= 2
                        ? 'bg-warning'
                        : 'bg-success'
                      : 'bg-muted',
                  )}
                />
              ))}
            </div>

            <ul className="mt-2 space-y-0.5">
              {strength.problems.length === 0 ? (
                <li className="flex items-center gap-1.5 text-xs text-success">
                  <Check className="size-3" aria-hidden="true" />
                  That is a strong password.
                </li>
              ) : (
                strength.problems.map((problem) => (
                  <li
                    key={problem}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <X className="size-3" aria-hidden="true" />
                    {problem}
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      <FormField
        label="Confirm password"
        id="confirmPassword"
        required
        error={errors.find((e) => e.field === 'confirmPassword')?.message}
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </FormField>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={marketingOptIn}
          onChange={(e) => setMarketingOptIn(e.target.checked)}
          className="mt-0.5 size-4 rounded border-input"
        />
        Email me new arrivals and occasional offers
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={acceptTerms}
          onChange={(e) => setAcceptTerms(e.target.checked)}
          className="mt-0.5 size-4 rounded border-input"
        />
        <span>
          I accept the{' '}
          <Link href="/pages/terms" className="underline underline-offset-4" target="_blank">
            terms
          </Link>{' '}
          and{' '}
          <Link
            href="/pages/privacy-policy"
            className="underline underline-offset-4"
            target="_blank"
          >
            privacy policy
          </Link>
        </span>
      </label>
      {errors.find((e) => e.field === 'acceptTerms') && (
        <p role="alert" className="text-xs text-destructive">
          {errors.find((e) => e.field === 'acceptTerms')?.message}
        </p>
      )}

      <Button
        type="submit"
        fullWidth
        size="lg"
        isLoading={isPending}
        loadingText="Creating your account"
      >
        Create account
      </Button>
    </form>
  );
}
