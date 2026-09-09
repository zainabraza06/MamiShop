import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, Package } from 'lucide-react';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/server/session';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { formatMoney, type Currency } from '@/lib/money';
import { describeMeasurements, type MeasurementTemplateKey } from '@/lib/measurements';
import { formatDate, addBusinessDays } from '@/lib/utils';
import { STATUS_PRESENTATION } from '@/lib/order-status';

export const metadata: Metadata = {
  title: 'Order confirmed',
  robots: { index: false, follow: false },
};

/**
 * Order confirmation.
 *
 * Reachable immediately after checkout without signing in — a guest has to be
 * able to see what they just bought. Access is therefore controlled by the
 * order number, which is a random-ish sequential value, plus one of:
 *   - the order belongs to the signed-in user, or
 *   - the order has no user attached (a guest order).
 *
 * A guest order number alone is enough to view the confirmation. That is a
 * deliberate, bounded trade: the page shows no payment details, and requiring
 * an email confirmation step here would strand every guest customer. The
 * richer tracking page at /track-order additionally requires the email
 * address.
 */
export default async function OrderConfirmedPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: { items: true },
  });

  if (!order) notFound();

  const user = await getCurrentUser();

  // An order attached to an account is only viewable by that account.
  if (order.userId && order.userId !== user?.id) notFound();

  const currency = order.currency as Currency;
  const address = order.shippingSnapshot as {
    fullName: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode?: string;
  };

  const maxStitching = 12;
  const estimatedFrom = addBusinessDays(order.placedAt, maxStitching);
  const estimatedTo = addBusinessDays(order.placedAt, maxStitching + 5);

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
              Made-to-measure pieces are cut and stitched after your order is confirmed, so this
              is longer than an off-the-shelf delivery.
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
                    item.measurementSnapshot as Record<string, number>,
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
          <Link href={`/api/orders/${order.orderNumber}/invoice`}>Download invoice</Link>
        </Button>
      </div>
    </div>
  );
}
