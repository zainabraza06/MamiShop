'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { CustomerStatus } from '@momishop/shared/api-types';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';

/**
 * Suspending an account, and adjusting points.
 *
 * Both write through the API rather than a server action, because both are
 * permission-gated on the server and the gate lives with the route.
 */

async function send(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: url.endsWith('/loyalty') ? 'POST' : 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(parsed?.error ?? 'That did not go through.');
  }
}

export function CustomerStatusForm({
  customerId,
  status,
}: {
  customerId: string;
  status: CustomerStatus;
}) {
  const router = useRouter();
  const [reason, setReason] = React.useState('');
  const [isPending, setIsPending] = React.useState(false);

  const suspended = status === 'SUSPENDED';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (
      !suspended &&
      !window.confirm(
        'Suspend this account? They will be signed out and cannot order until reinstated.',
      )
    ) {
      return;
    }

    setIsPending(true);
    try {
      await send(`/api/admin/customers/${customerId}`, {
        status: suspended ? 'ACTIVE' : 'SUSPENDED',
        reason: reason || undefined,
      });

      toast.success(suspended ? 'Account reinstated.' : 'Account suspended.');
      setReason('');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not go through.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {suspended
          ? 'This account is suspended. Reinstating lets them sign in and order again.'
          : 'Suspending signs them out and blocks new orders. Their history is kept either way.'}
      </p>

      {!suspended && (
        <FormField
          label="Reason"
          id="suspend-reason"
          required
          hint="Recorded in the audit log."
          className="text-start"
        >
          <Textarea
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </FormField>
      )}

      <Button
        type="submit"
        variant={suspended ? 'outline' : 'destructive'}
        fullWidth
        isLoading={isPending}
        loadingText="Saving"
      >
        {suspended ? 'Reinstate account' : 'Suspend account'}
      </Button>
    </form>
  );
}

export function LoyaltyForm({ customerId, balance }: { customerId: string; balance: number }) {
  const router = useRouter();
  const [delta, setDelta] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [isPending, setIsPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);

    try {
      await send(`/api/admin/customers/${customerId}/loyalty`, {
        delta: Number(delta),
        reason,
      });

      toast.success('Points adjusted.');
      setDelta('');
      setReason('');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That did not go through.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Balance: <span className="font-medium tabular-nums">{balance}</span> points
      </p>

      <FormField
        label="Adjustment"
        id="loyalty-delta"
        required
        hint="Negative to take points away."
      >
        <Input
          type="number"
          step="1"
          value={delta}
          onChange={(event) => setDelta(event.target.value)}
          required
        />
      </FormField>

      <FormField label="Reason" id="loyalty-reason" required>
        <Input value={reason} onChange={(event) => setReason(event.target.value)} required />
      </FormField>

      <Button type="submit" variant="outline" fullWidth isLoading={isPending} loadingText="Saving">
        Adjust points
      </Button>
    </form>
  );
}
