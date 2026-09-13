'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { CustomRequestStatus } from '@momishop/shared/api-types';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/input';
import { isClosedRequest } from '@/lib/custom-requests';

/**
 * Declining, closing or reopening a request. Whatever is chosen is posted into
 * the conversation, with the optional note, so the customer sees why.
 */
export function RequestStatusControl({
  requestId,
  status,
}: {
  requestId: string;
  status: CustomRequestStatus;
}) {
  const router = useRouter();
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);

  if (status === 'ORDERED') {
    return <p className="text-sm text-muted-foreground">This request has become an order.</p>;
  }

  async function change(next: 'OPEN' | 'DECLINED' | 'CLOSED') {
    if (
      next === 'DECLINED' &&
      !window.confirm('Decline this request? The customer is told in the conversation.')
    ) {
      return;
    }

    setBusy(next);
    try {
      const response = await fetch(`/api/admin/custom-requests/${requestId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, note: note.trim() || undefined }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'The status was not changed.');
      }
      setNote('');
      toast.success(
        next === 'OPEN'
          ? 'Request reopened.'
          : next === 'DECLINED'
            ? 'Request declined.'
            : 'Request closed.',
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The status was not changed.');
    } finally {
      setBusy(null);
    }
  }

  if (isClosedRequest(status)) {
    return (
      <Button
        type="button"
        variant="outline"
        isLoading={busy === 'OPEN'}
        loadingText="Reopening"
        onClick={() => void change('OPEN')}
      >
        Reopen request
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <FormField
        label="Note for the customer"
        id="status-note"
        hint="Optional. Posted with the change."
      >
        <Textarea
          rows={2}
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          isLoading={busy === 'DECLINED'}
          loadingText="Declining"
          disabled={busy !== null}
          onClick={() => void change('DECLINED')}
        >
          Decline
        </Button>
        <Button
          type="button"
          variant="ghost"
          isLoading={busy === 'CLOSED'}
          loadingText="Closing"
          disabled={busy !== null}
          onClick={() => void change('CLOSED')}
        >
          Close
        </Button>
      </div>
    </div>
  );
}
