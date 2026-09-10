'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Minus, Plus, Ruler, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { formatMoney, type Currency } from '@/lib/money';
import { describeMeasurements, type MeasurementTemplateKey } from '@/lib/measurements';
import { cn } from '@/lib/utils';
import type { CartLineIssue } from '@/server/cart';

interface CartLine {
  id: string;
  quantity: number;
  productName: string;
  productSlug: string;
  variantName: string | null;
  unitPrice: number;
  currency: string;
  imageUrl: string | null;
  imageAlt: string;
  stitchingDays: number;
  measurementUnit: string | null;
  measurementValues: Record<string, number> | null;
  measurementTemplate: string | null;
  customNote: string | null;
  issue: CartLineIssue | null;
}

/**
 * Cart contents and summary.
 *
 * Quantity updates are optimistic: the number changes immediately and rolls
 * back if the server rejects it. Waiting a round-trip to redraw a number the
 * user just clicked feels broken, and the failure case here is rare and
 * recoverable.
 *
 * The measurement summary is shown on every line. This is the customer's last
 * chance to notice that a garment is about to be cut to the wrong numbers.
 */
export function CartView({
  lines: initialLines,
  couponCode,
}: {
  lines: CartLine[];
  couponCode: string | null;
}) {
  const router = useRouter();
  const [lines, setLines] = React.useState(initialLines);
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const currency = (lines[0]?.currency ?? 'PKR') as Currency;
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const blockingIssues = lines.filter(
    (line) => line.issue && line.issue.reason !== 'QUANTITY_REDUCED',
  );

  async function updateQuantity(id: string, quantity: number) {
    const previous = lines;
    setPendingId(id);

    // Optimistic: reflect the change now, reconcile after.
    setLines((current) =>
      quantity === 0
        ? current.filter((line) => line.id !== id)
        : current.map((line) => (line.id === id ? { ...line, quantity } : line)),
    );

    try {
      const response = await fetch('/api/cart/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: id, quantity }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Could not update your bag');
      }

      router.refresh();
    } catch (error) {
      setLines(previous);
      toast.error(error instanceof Error ? error.message : 'Could not update your bag');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_360px]">
      <div>
        {blockingIssues.length > 0 && (
          <div
            role="alert"
            className="mb-6 rounded-md border border-destructive/40 bg-destructive/5 p-4"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Some items need your attention
            </h2>
            <ul className="mt-2 space-y-1 ps-6 text-sm text-destructive">
              {blockingIssues.map((line) => (
                <li key={line.id}>{line.issue?.message}</li>
              ))}
            </ul>
          </div>
        )}

        <ul className="divide-y">
          {lines.map((line) => (
            <li key={line.id} className="py-6 first:pt-0">
              <article className="flex gap-4">
                <Link
                  href={`/products/${line.productSlug}`}
                  className="relative size-24 shrink-0 overflow-hidden rounded-md bg-muted sm:size-32"
                >
                  {line.imageUrl && (
                    <Image
                      src={line.imageUrl}
                      alt={line.imageAlt}
                      fill
                      sizes="128px"
                      className="object-cover"
                    />
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="font-medium">
                        <Link
                          href={`/products/${line.productSlug}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {line.productName}
                        </Link>
                      </h2>
                      {line.variantName && (
                        <p className="text-sm text-muted-foreground">{line.variantName}</p>
                      )}
                    </div>

                    <p className="font-serif font-semibold">
                      {formatMoney(line.unitPrice * line.quantity, currency)}
                    </p>
                  </div>

                  {line.measurementValues && line.measurementTemplate && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                      <Ruler className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                      <span>
                        {describeMeasurements(
                          line.measurementTemplate as MeasurementTemplateKey,
                          line.measurementValues,
                          line.measurementUnit === 'CM' ? 'CM' : 'INCH',
                        )}
                      </span>
                    </p>
                  )}

                  {line.customNote && (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      Note: {line.customNote}
                    </p>
                  )}

                  <p className="mt-1 text-xs text-muted-foreground">
                    Ready in about {line.stitchingDays} working days
                  </p>

                  {line.issue && (
                    <p
                      role="status"
                      className={cn(
                        'mt-2 text-xs font-medium',
                        line.issue.reason === 'QUANTITY_REDUCED'
                          ? 'text-warning'
                          : 'text-destructive',
                      )}
                    >
                      {line.issue.message}
                    </p>
                  )}

                  <div className="mt-3 flex items-center gap-3">
                    <div className="inline-flex items-center rounded-md border">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        disabled={pendingId === line.id || line.quantity <= 1}
                        onClick={() => updateQuantity(line.id, line.quantity - 1)}
                        aria-label={`Decrease quantity of ${line.productName}`}
                      >
                        <Minus aria-hidden="true" />
                      </Button>
                      <span className="w-9 text-center text-sm font-medium">{line.quantity}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        disabled={pendingId === line.id || line.quantity >= 20}
                        onClick={() => updateQuantity(line.id, line.quantity + 1)}
                        aria-label={`Increase quantity of ${line.productName}`}
                      >
                        <Plus aria-hidden="true" />
                      </Button>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pendingId === line.id}
                      onClick={() => updateQuantity(line.id, 0)}
                    >
                      <Trash2 aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">Remove</span>
                      <span className="sr-only"> {line.productName}</span>
                    </Button>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      </div>

      {/* Summary — sticky so the total and CTA stay visible while scrolling. */}
      <aside aria-labelledby="order-summary" className="lg:sticky lg:top-24 lg:h-fit">
        <div className="rounded-lg border p-6">
          <h2 id="order-summary" className="font-serif text-lg font-semibold">
            Order summary
          </h2>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="font-medium">{formatMoney(subtotal, currency)}</dd>
            </div>
            {couponCode && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Coupon</dt>
                <dd>
                  <Badge variant="success">{couponCode}</Badge>
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd className="text-muted-foreground">Calculated at checkout</dd>
            </div>
          </dl>

          <Separator className="my-4" />

          <div className="flex items-baseline justify-between">
            <span className="font-medium">Estimated total</span>
            <span className="font-serif text-xl font-semibold">
              {formatMoney(subtotal, currency)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Inclusive of GST</p>

          <Button
            size="lg"
            fullWidth
            className="mt-6"
            disabled={blockingIssues.length > 0}
            asChild={blockingIssues.length === 0}
          >
            {blockingIssues.length === 0 ? (
              <Link href="/checkout">Continue to checkout</Link>
            ) : (
              <span>Resolve issues to continue</span>
            )}
          </Button>

          <Button variant="ghost" fullWidth className="mt-2" asChild>
            <Link href="/products">Continue shopping</Link>
          </Button>
        </div>
      </aside>
    </div>
  );
}
