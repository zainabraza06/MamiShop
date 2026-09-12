'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { formatMoney, type Currency } from '@momishop/shared/money';
import {
  STATUS_PRESENTATION,
  allowedTransitions,
  type OrderStatus,
} from '@momishop/shared/order-status';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { SelectField } from '@/components/ui/select-field';

/**
 * The three things staff do to an order: move it along, refund it, note
 * something for the next person.
 *
 * The status choices come from the shared state machine, so the form can only
 * offer moves the server would accept — the server checks again regardless,
 * because a form is not a rule.
 */

async function send(path: string, method: string, body: unknown): Promise<void> {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(problem?.error ?? `That failed with ${response.status}.`);
  }
}

export function OrderStatusForm({
  orderId,
  status,
  courier,
  trackingNumber,
}: {
  orderId: string;
  status: OrderStatus;
  courier: string | null;
  trackingNumber: string | null;
}) {
  const router = useRouter();
  const options = allowedTransitions(status);

  const [next, setNext] = React.useState<string>(options[0] ?? '');
  const [courierName, setCourierName] = React.useState(courier ?? '');
  const [tracking, setTracking] = React.useState(trackingNumber ?? '');
  const [note, setNote] = React.useState('');
  const [notify, setNotify] = React.useState(true);
  const [isPending, setIsPending] = React.useState(false);

  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        A {STATUS_PRESENTATION[status].label.toLowerCase()} order cannot change status.
      </p>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);
    try {
      await send(`/api/admin/orders/${orderId}/status`, 'PATCH', {
        status: next,
        courier: courierName || undefined,
        trackingNumber: tracking || undefined,
        note: note || undefined,
        notifyCustomer: notify,
      });
      toast.success(`Order moved to ${STATUS_PRESENTATION[next as OrderStatus].label}.`);
      setNote('');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the order.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <SelectField
        label="Move to"
        id="order-status"
        value={next}
        onValueChange={setNext}
        options={options.map((option) => ({
          value: option,
          label: STATUS_PRESENTATION[option].label,
        }))}
      />

      {next === 'SHIPPED' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Courier" id="courier" hint="Shown on the customer's tracking page.">
            <Input
              value={courierName}
              onChange={(e) => setCourierName(e.target.value)}
              placeholder="TCS"
            />
          </FormField>
          <FormField label="Tracking number" id="tracking">
            <Input value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </FormField>
        </div>
      )}

      <FormField label="Note" id="status-note" hint="Appears on the customer's tracking timeline.">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </FormField>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
          className="size-4 rounded border-input"
        />
        Notify the customer
      </label>

      <Button type="submit" isLoading={isPending} loadingText="Updating">
        Update status
      </Button>
    </form>
  );
}

export function RefundForm({
  orderId,
  currency,
  grandTotal,
  refundedTotal,
}: {
  orderId: string;
  currency: string;
  grandTotal: number;
  refundedTotal: number;
}) {
  const router = useRouter();
  const remaining = grandTotal - refundedTotal;

  // Minor units are the storage unit; staff think in rupees.
  const [amount, setAmount] = React.useState(String(Math.round(remaining / 100)));
  const [reason, setReason] = React.useState('');
  const [restock, setRestock] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);

  if (remaining <= 0) {
    return <p className="text-sm text-muted-foreground">This order is fully refunded.</p>;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const minorUnits = Math.round(Number(amount) * 100);
    if (!Number.isFinite(minorUnits) || minorUnits <= 0) {
      toast.error('Enter an amount to refund.');
      return;
    }

    if (
      !window.confirm(
        `Record a refund of ${formatMoney(minorUnits, currency as Currency)}?\n\nThis writes the refund down; move the money in your payment provider (or in cash for COD).`,
      )
    ) {
      return;
    }

    setIsPending(true);
    try {
      await send(`/api/admin/orders/${orderId}/refund`, 'POST', {
        amount: minorUnits,
        reason,
        restock,
      });
      toast.success('Refund recorded.');
      setReason('');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not record the refund.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {formatMoney(remaining, currency as Currency)} still refundable.
      </p>

      <FormField label={`Amount (${currency})`} id="refund-amount" required>
        <Input
          type="number"
          min="1"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </FormField>

      <FormField label="Reason" id="refund-reason" required hint="Recorded in the audit log.">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required />
      </FormField>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={restock}
          onChange={(e) => setRestock(e.target.checked)}
          className="size-4 rounded border-input"
        />
        Put the items back into stock
      </label>

      <Button type="submit" variant="outline" isLoading={isPending} loadingText="Recording">
        Record refund
      </Button>
    </form>
  );
}

export function StaffNoteForm({ orderId, note }: { orderId: string; note: string | null }) {
  const router = useRouter();
  const [value, setValue] = React.useState(note ?? '');
  const [isPending, setIsPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);
    try {
      await send(`/api/admin/orders/${orderId}/note`, 'PATCH', { note: value });
      toast.success('Note saved.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the note.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <FormField
        label="Staff note"
        id="staff-note"
        hint="Internal only — the customer never sees this."
      >
        <Textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
      </FormField>
      <Button type="submit" variant="outline" size="sm" isLoading={isPending} loadingText="Saving">
        Save note
      </Button>
    </form>
  );
}
