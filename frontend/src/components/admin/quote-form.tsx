'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';

/**
 * Sending a price for a custom request. It appears in the conversation as a
 * card the customer can accept, and replaces any earlier quote still on offer.
 */
export function QuoteForm({
  requestId,
  hasOpenQuote,
}: {
  requestId: string;
  hasOpenQuote: boolean;
}) {
  const router = useRouter();
  const [price, setPrice] = React.useState('');
  const [stitchingDays, setStitchingDays] = React.useState('10');
  const [validDays, setValidDays] = React.useState('7');
  const [note, setNote] = React.useState('');
  const [isPending, setIsPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (hasOpenQuote && !window.confirm('Replace the quote the customer has not answered yet?')) {
      return;
    }

    setIsPending(true);
    try {
      const response = await fetch(`/api/admin/custom-requests/${requestId}/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Math.round(Number(price || '0') * 100),
          stitchingDays: Number(stitchingDays || '0'),
          validDays: Number(validDays || '7'),
          note,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          issues?: { message: string }[];
        } | null;
        throw new Error(data?.issues?.[0]?.message ?? data?.error ?? 'The quote was not sent.');
      }
      toast.success('Quote sent to the customer.');
      setPrice('');
      setNote('');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The quote was not sent.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <FormField
        label="Price (Rs)"
        id="quote-price"
        required
        hint="For the piece itself. Delivery and tax are added at checkout."
      >
        <Input
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value.replace(/[^\d.]/g, ''))}
          required
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Stitching days" id="quote-days" required>
          <Input
            inputMode="numeric"
            value={stitchingDays}
            onChange={(event) => setStitchingDays(event.target.value.replace(/\D/g, ''))}
            required
          />
        </FormField>
        <FormField label="Valid for (days)" id="quote-valid">
          <Input
            inputMode="numeric"
            value={validDays}
            onChange={(event) => setValidDays(event.target.value.replace(/\D/g, ''))}
          />
        </FormField>
      </div>
      <FormField
        label="Note"
        id="quote-note"
        hint="Shown with the quote: fabric, what is included."
      >
        <Textarea
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </FormField>
      <Button type="submit" fullWidth isLoading={isPending} loadingText="Sending">
        {hasOpenQuote ? 'Send a new quote' : 'Send quote'}
      </Button>
    </form>
  );
}
