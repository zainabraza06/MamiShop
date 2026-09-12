import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, Package } from 'lucide-react';
import type { OrderConfirmation } from '@momishop/shared/api-types';
import { describeMeasurements, type MeasurementTemplateKey } from '@momishop/shared/measurements';
import { formatMoney, type Currency } from '@momishop/shared/money';
import { STATUS_PRESENTATION } from '@momishop/shared/order-status';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { apiGetOrNull } from '@/lib/api';
import { addBusinessDays, formatDate } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Order confirmed',
  robots: { index: false, follow: false },
};

/**
 * Order confirmation.
 *
 * Reachable immediately after checkout without signing in — a guest has to be
 * able to see what they just bought. The API decides who may view an order:
 * one attached to an account is visible only to that account, and a guest
 * order to anyone holding its number. Either way a refusal arrives as a 404,
 * so this page cannot be used to learn which order numbers exist.
 */
export default async function OrderConfirmedPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;
  const data = await apiGetOrNull<{ order: OrderConfirmation }>(
    `/orders/${encodeURIComponent(orderNumber)}`,
  );

  if (!data) notFound();

  const { order } = data;
  const currency = order.currency as Currency;
  const address = order.shippingAddress;

  const maxStitching = 12;
  const placedAt = new Date(order.placedAt);
  const estimatedFrom = addBusinessDays(placedAt, maxStitching);
  const estimatedTo = addBusinessDays(placedAt, maxStitching + 5);

  return (
    <div className="container max-w-3xl py-12">
      <div className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="size-7 text-success" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-display font-semibold">Thank you — your order is in</h1>
        <p className="mt-2 text-muted-foreground">
          We have sent a confirmation to <strong>{order.email}</strong>. Your order number is{' '}
          <strong className="font-mono">{order.orderNumber}</strong>.
        </p>
      </div>

      <div className="mt-10 rounded-lg border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-lg font-semibold">
              {STATUS_PRESENTATION[order.status].label}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {STATUS_PRESENTATION[order.status].customerDescription}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href={`/track-order?order=${order.orderNumber}`}>Track this order</Link>
          </Button>
        </div>

        <Separator className="my-6" />

        <div className="flex items-start gap-3">
          <Package className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">Estimated delivery</p>
            <p className="text-sm text-muted-foreground">
              {formatDate(estimatedFrom)} – {formatDate(estimatedTo)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Made-to-measure pieces are cut and stitched after your order is confirmed, so this is
              longer than an off-the-shelf delivery.
            </p>
          </div>
        </div>
      </div>

      {/* Items, with the measurements we will actually cut to. */}
      <section aria-labelledby="items-heading" className="mt-8">
        <h2 id="items-heading" className="font-serif text-lg font-semibold">
          What we are making for you
        </h2>

        <ul className="mt-4 divide-y rounded-lg border">
          {order.items.map((item) => (
            <li key={item.id} className="p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {item.quantity} × {item.productName}
                  </p>
                  {item.variantName && (
                    <p className="text-sm text-muted-foreground">{item.variantName}</p>
                  )}
                </div>
                <p className="font-medium">{formatMoney(item.lineTotal, currency)}</p>
              </div>

              {item.measurementSnapshot && item.measurementTemplate && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium">Cut to:</span>{' '}
                  {describeMeasurements(
                    item.measurementTemplate as MeasurementTemplateKey,
                    item.measurementSnapshot,
                    item.measurementUnit === 'CM' ? 'CM' : 'INCH',
                  )}
                </p>
              )}

              {item.customNote && (
                <p className="mt-1 text-xs italic text-muted-foreground">
                  Your note: {item.customNote}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        <section aria-labelledby="delivery-heading">
          <h2 id="delivery-heading" className="text-sm font-semibold">
            Delivering to
          </h2>
          <address className="mt-2 text-sm not-italic leading-relaxed text-muted-foreground">
            {address.fullName}
            <br />
            {address.line1}
            {address.line2 && (
              <>
                <br />
                {address.line2}
              </>
            )}
            <br />
            {address.city}, {address.state}
            {address.postalCode && ` ${address.postalCode}`}
          </address>
        </section>

        <section aria-labelledby="payment-heading">
          <h2 id="payment-heading" className="text-sm font-semibold">
            Payment
          </h2>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{formatMoney(order.subtotal, currency)}</dd>
            </div>
            {order.discountTotal > 0 && (
              <div className="flex justify-between text-success">
                <dt>Discount</dt>
                <dd>−{formatMoney(order.discountTotal, currency)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd>
                {order.shippingTotal === 0 ? 'Free' : formatMoney(order.shippingTotal, currency)}
              </dd>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold">
              <dt>Total</dt>
              <dd>{formatMoney(order.grandTotal, currency)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            {order.paymentMethod === 'COD'
              ? 'Payable in cash when your parcel arrives.'
              : `Paid by ${order.paymentMethod.toLowerCase()}.`}
          </p>
        </section>
      </div>

      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/products">Continue shopping</Link>
        </Button>
        <Button variant="outline" asChild>
          {/* A plain anchor: the invoice is a file download served by the API, not a page. */}
          <a href={`/api/orders/${order.orderNumber}/invoice`}>Download invoice</a>
        </Button>
      </div>
    </div>
  );
}
