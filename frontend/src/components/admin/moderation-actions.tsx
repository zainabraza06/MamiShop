'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import type { ReturnStatus } from '@momishop/shared/api-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select-field';

async function send(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(problem?.error ?? `That failed with ${response.status}.`);
  }
}

/** Approve or reject one review. Either way the product's rating is recomputed. */
export function ReviewDecision({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<'APPROVED' | 'REJECTED' | null>(null);

  async function decide(status: 'APPROVED' | 'REJECTED') {
    setPending(status);
    try {
      await send(`/api/admin/reviews/${reviewId}`, { status });
      toast.success(status === 'APPROVED' ? 'Review published.' : 'Review rejected.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the review.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={() => void decide('APPROVED')} isLoading={pending === 'APPROVED'}>
        <Check aria-hidden="true" />
        Publish
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void decide('REJECTED')}
        isLoading={pending === 'REJECTED'}
      >
        <X aria-hidden="true" />
        Reject
      </Button>
    </div>
  );
}

const RETURN_STATUSES: { value: ReturnStatus; label: string }[] = [
  { value: 'REQUESTED', label: 'Requested' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'IN_TRANSIT', label: 'On its way back' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'EXCHANGED', label: 'Exchanged' },
  { value: 'CLOSED', label: 'Closed' },
];

/**
 * Returns are a conversation, not a pipeline: a piece may come back for
 * alteration, go out again, and close without a refund. So every status is
 * selectable, and the change is recorded with who made it.
 */
export function ReturnDecision({
  returnId,
  status,
  staffNote,
}: {
  returnId: string;
  status: ReturnStatus;
  staffNote: string | null;
}) {
  const router = useRouter();
  const [next, setNext] = React.useState<string>(status);
  const [note, setNote] = React.useState(staffNote ?? '');
  const [isPending, setIsPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);
    try {
      await send(`/api/admin/returns/${returnId}`, { status: next, staffNote: note || undefined });
      toast.success('Return updated.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the return.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <SelectField
        label="Status"
        hideLabel
        id={`return-status-${returnId}`}
        value={next}
        onValueChange={setNext}
        options={RETURN_STATUSES}
        className="w-44"
      />
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the team"
        aria-label="Staff note"
        className="w-56"
      />
      <Button type="submit" size="sm" variant="outline" isLoading={isPending} loadingText="Saving">
        Save
      </Button>
    </form>
  );
}
