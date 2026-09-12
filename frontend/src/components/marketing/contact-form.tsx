'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { FormField, FormErrorSummary } from '@/components/ui/form-field';

/**
 * Contact form.
 *
 * Includes the same honeypot as the newsletter signup: a field hidden from
 * sight and from assistive tech, rejected server-side when filled.
 */
export function ContactForm() {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [orderNumber, setOrderNumber] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [website, setWebsite] = React.useState('');

  const [errors, setErrors] = React.useState<{ field: string; message: string }[]>([]);
  const [isPending, setIsPending] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);
    setErrors([]);

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone: phone || undefined,
          orderNumber: orderNumber || undefined,
          subject,
          message,
          website,
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        error?: string;
        issues?: { field: string; message: string }[];
      } | null;

      if (!response.ok) {
        if (body?.issues) setErrors(body.issues);
        throw new Error(body?.error ?? 'We could not send your message.');
      }

      setSent(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'We could not send your message.');
    } finally {
      setIsPending(false);
    }
  }

  if (sent) {
    return (
      <div role="status" className="mt-8 rounded-lg border bg-secondary/40 p-6">
        <h2 className="font-serif text-lg font-semibold">Thank you — your message is with us</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We reply within one working day, to {email}.
        </p>
      </div>
    );
  }

  const errorFor = (field: string) => errors.find((e) => e.field === field)?.message;

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-4">
      <FormErrorSummary errors={errors} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Your name" id="contact-name" required error={errorFor('name')}>
          <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>

        <FormField label="Email" id="contact-email" required error={errorFor('email')}>
          <Input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>

        <FormField label="Mobile number (optional)" id="contact-phone" error={errorFor('phone')}>
          <Input
            type="tel"
            autoComplete="tel"
            placeholder="0300 1234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </FormField>

        <FormField
          label="Order number (optional)"
          id="contact-order"
          hint="If your message is about an order."
          error={errorFor('orderNumber')}
        >
          <Input
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder="MS-2026-000123"
          />
        </FormField>
      </div>

      <FormField label="Subject" id="contact-subject" required error={errorFor('subject')}>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </FormField>

      <FormField label="Message" id="contact-message" required error={errorFor('message')}>
        <Textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
      </FormField>

      {/* Honeypot. Hidden from sight and from assistive tech, never focusable. */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <Button type="submit" size="lg" isLoading={isPending} loadingText="Sending">
        Send message
      </Button>
    </form>
  );
}
