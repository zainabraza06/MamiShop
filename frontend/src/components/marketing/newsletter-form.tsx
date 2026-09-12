'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Newsletter signup.
 *
 * Includes a honeypot field: hidden from sight and from assistive tech, never
 * focusable, and rejected server-side if filled. Bots that parse the DOM fill
 * every input they find, so this removes most automated signups without
 * making a human solve anything.
 *
 * The success message is identical whether the address is new or already
 * subscribed — otherwise the form becomes a way to test whether a given email
 * is on the list.
 */
export function NewsletterForm({
  source = 'FOOTER',
  className,
}: {
  source?: 'FOOTER' | 'EXIT_INTENT' | 'CHECKOUT' | 'POPUP';
  className?: string;
}) {
  const [email, setEmail] = React.useState('');
  const [website, setWebsite] = React.useState('');
  const [isPending, setIsPending] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;

    setIsPending(true);
    try {
      const response = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source, website }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Subscription failed');
      }

      setDone(true);
      setEmail('');
      toast.success('Thank you — please check your inbox to confirm.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'We could not sign you up just now.');
    } finally {
      setIsPending(false);
    }
  }

  if (done) {
    return (
      <p role="status" className={cn('text-sm text-muted-foreground', className)}>
        Thank you — please check your inbox to confirm your subscription.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={cn('flex flex-col gap-2 sm:flex-row', className)}>
      <div className="flex-1">
        <label htmlFor={`newsletter-email-${source}`} className="sr-only">
          Email address
        </label>
        <Input
          id={`newsletter-email-${source}`}
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {/*
        Honeypot. aria-hidden + tabIndex=-1 keep it away from screen readers and
        the tab order; the wrapper is positioned off-screen rather than
        display:none, which some bots specifically skip.
      */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={`newsletter-website-${source}`}>Leave this field empty</label>
        <input
          id={`newsletter-website-${source}`}
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <Button type="submit" isLoading={isPending} loadingText="Signing you up">
        Subscribe
      </Button>
    </form>
  );
}
