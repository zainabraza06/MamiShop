import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { AdminOrderDetail } from '@momishop/shared/api-types';
import { describeMeasurements, type MeasurementTemplateKey } from '@momishop/shared/measurements';
import { formatMoney, type Currency } from '@momishop/shared/money';
import { STATUS_PRESENTATION } from '@momishop/shared/order-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { OrderStatusForm, RefundForm, StaffNoteForm } from '@/components/admin/order-actions';
import { ApiError, apiGet } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Order' };

/**
 * One order, and everything staff need to act on it.
 *
 * The measurements are shown per line, because that is what the workshop cuts
 * to and the most common reason someone opens this page.
 */
export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let order: AdminOrderDetail;
  try {
    ({ order } = await apiGet<{ order: AdminOrderDetail }>(`/admin/orders/${id}`));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const currency = order.currency as Currency;
  const address = order.shippingSnapshot;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="link" size="sm" asChild className="px-0">
          <Link href="/admin/orders">
            <ArrowLeft aria-hidden="true" />
            All orders
          </Link>
        </Button>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-2xl font-semibold">{order.orderNumber}</h1>
          <Badge>{STATUS_PRESENTATION[order.status].label}</Badge>
          {order.isManual && <Badge variant="secondary">Phone order</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Placed {formatDateTime(order.placedAt)} · {order.email} · {order.phone}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">What we are making</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {order.items.map((item) => (
                  <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {item.quantity} × {item.productName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.variantName ? `${item.variantName} · ` : ''}
                          {item.sku}
                        </p>
                      </div>
                      <p className="tabular-nums">{formatMoney(item.lineTotal, currency)}</p>
                    </div>

                    {item.measurementSnapshot && item.measurementTemplate && (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
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
                        Customer note: {item.customNote}
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              <Separator className="my-4" />

              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="tabular-nums">{formatMoney(order.subtotal, currency)}</dd>
                </div>
                {order.discountTotal > 0 && (
                  <div className="flex justify-between text-success">
                    <dt>Discount{order.couponCode ? ` (${order.couponCode})` : ''}</dt>
                    <dd className="tabular-nums">−{formatMoney(order.discountTotal, currency)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Delivery</dt>
                  <dd className="tabular-nums">{formatMoney(order.shippingTotal, currency)}</dd>
                </div>
                {order.taxTotal > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Tax</dt>
                    <dd className="tabular-nums">{formatMoney(order.taxTotal, currency)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t pt-1 font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{formatMoney(order.grandTotal, currency)}</dd>
                </div>
                {order.refundedTotal > 0 && (
                  <div className="flex justify-between text-destructive">
                    <dt>Refunded</dt>
                    <dd className="tabular-nums">−{formatMoney(order.refundedTotal, currency)}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {order.events.map((event) => (
                  <li key={event.id} className="text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">{event.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(event.createdAt)}
                      </p>
                    </div>
                    {event.description && (
                      <p className="text-muted-foreground">{event.description}</p>
                    )}
                    {!event.isPublic && (
                      <p className="text-xs text-muted-foreground">Internal only</p>
                    )}
                  </li>
                ))}
              </ol>

              {order.payments.length > 0 && (
                <>
                  <Separator className="my-4" />
                  <h3 className="text-sm font-semibold">Payments</h3>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {order.payments.map((payment) => (
                      <li key={payment.id} className="flex justify-between gap-2">
                        <span>
                          {payment.kind.toLowerCase()} · {payment.status.toLowerCase()}
                        </span>
                        <span className="tabular-nums">
                          {formatMoney(payment.amount, payment.currency as Currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Move it along</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderStatusForm
                orderId={order.id}
                status={order.status}
                courier={order.courier}
                trackingNumber={order.trackingNumber}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Delivering to</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              <address className="not-italic leading-relaxed">
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
                {address.postalCode ? ` ${address.postalCode}` : ''}
              </address>

              {order.trackingNumber && (
                <p className="mt-3">
                  {order.courier ?? 'Courier'}:{' '}
                  <span className="font-mono">{order.trackingNumber}</span>
                </p>
              )}

              {order.customerNote && (
                <p className="mt-3 italic">Customer note: {order.customerNote}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Refund</CardTitle>
            </CardHeader>
            <CardContent>
              <RefundForm
                orderId={order.id}
                currency={order.currency}
                grandTotal={order.grandTotal}
                refundedTotal={order.refundedTotal}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Internal</CardTitle>
            </CardHeader>
            <CardContent>
              <StaffNoteForm orderId={order.id} note={order.staffNote} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
