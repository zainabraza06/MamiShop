'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { PackageSearch } from 'lucide-react';
import type { OrderTracking } from '@momishop/shared/api-types';
import { formatMoney, type Currency } from '@momishop/shared/money';
import { STATUS_PRESENTATION } from '@momishop/shared/order-status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/utils';

/**
 * Order tracking without an account.
 *
 * Both the order number and the email it was placed with are required. The
 * order number alone is sequential and therefore guessable, so asking for the
 * address as well is what stops this page becoming a way to read strangers'
 * deliveries. The API answers "not found" for a wrong pair either way, so this
 * form cannot be used to test which order numbers exist.
 */
export function TrackOrderForm() {
  const searchParams = useSearchParams();

  const [orderNumber, setOrderNumber] = React.useState(searchParams.get('order') ?? '');
  const [email, setEmail] = React.useState('');
  const [order, setOrder] = React.useState<OrderTracking | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);
    setError(null);
    setOrder(null);

    try {
      const query = new URLSearchParams({ orderNumber: orderNumber.trim(), email: email.trim() });
      const response = await fetch(`/api/orders/track?${query}`);

      if (response.status === 404) {
        setError('We could not find an order with that number and email address.');
        return;
      }
      if (response.status === 429) {
        setError('Too many attempts just now. Please wait a minute and try again.');
        return;
      }
      if (!response.ok) throw new Error(`Lookup failed with ${response.status}`);

      const body = (await response.json()) as { order: OrderTracking };
      setOrder(body.order);
    } catch {
      setError('We could not look that up just now. Please try again.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="mt-8">
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Order number"
          id="order-number"
          required
          hint="For example MS-2026-000123"
        >
          <Input
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            required
            autoComplete="off"
            placeholder="MS-2026-000123"
          />
        </FormField>

        <FormField label="Email address" id="order-email" required hint="The one used to order.">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </FormField>

        <div className="sm:col-span-2">
          <Button type="submit" size="lg" isLoading={isPending} loadingText="Looking it up">
            Track my order
          </Button>
        </div>
      </form>

      {error && (
        <p
          role="alert"
          className="mt-6 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {order && (
        <section aria-live="polite" className="mt-10">
          <div className="rounded-lg border p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-lg font-semibold">
                  {STATUS_PRESENTATION[order.status].label}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {STATUS_PRESENTATION[order.status].customerDescription}
                </p>
              </div>
              <p className="font-mono text-sm">{order.orderNumber}</p>
            </div>

            {order.trackingNumber && (
              <p className="mt-4 text-sm">
                <span className="text-muted-foreground">
                  {order.courier ?? 'Courier'} tracking number:{' '}
                </span>
                <span className="font-mono">{order.trackingNumber}</span>
              </p>
            )}

            <ul className="mt-4 text-sm text-muted-foreground">
              {order.items.map((item) => (
                <li key={item.id}>
                  {item.quantity} × {item.productName}
                  {item.variantName ? ` (${item.variantName})` : ''}
                </li>
              ))}
            </ul>

            <p className="mt-4 text-sm font-medium">
              Total {formatMoney(order.grandTotal, order.currency as Currency)}
            </p>
          </div>

          {order.events.length > 0 && (
            <ol className="mt-6 space-y-4 border-s ps-6">
              {order.events.map((event) => (
                <li key={event.id} className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute -start-[27px] top-1.5 size-2.5 rounded-full bg-primary"
                  />
                  <p className="text-sm font-medium">{event.title}</p>
                  {event.description && (
                    <p className="text-sm text-muted-foreground">{event.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {!order && !error && !isPending && (
        <EmptyState
          icon={PackageSearch}
          title="Enter your details above"
          description="Your order number is in the confirmation email we sent when you ordered."
          className="mt-10"
        />
      )}
    </div>
  );
}
