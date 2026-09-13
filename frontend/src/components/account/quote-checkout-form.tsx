'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { QuoteCheckoutContext, QuoteCheckoutPreview } from '@momishop/shared/api-types';
import { formatMoney } from '@momishop/shared/money';
import { PAKISTAN_PROVINCES } from '@momishop/shared/regions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormErrorSummary, FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select-field';

/**
 * Accepting a quote: where it goes, how it is delivered, and how it is paid.
 *
 * The summary is priced by the API as the customer fills in the address, with
 * the same zones, rates and tax rules as checkout, so the total shown is the
 * total charged. Cash on delivery is only offered up to the limit in the
 * delivery policy; above it the customer pays by bank transfer.
 */

type Issue = { field: string; message: string };
type Payment = 'COD' | 'BANK_TRANSFER';

const rs = (minor: number) => formatMoney(minor, 'PKR');

export function QuoteCheckoutForm({ context }: { context: QuoteCheckoutContext }) {
  const router = useRouter();
  const base = `/api/custom-requests/${context.request.id}/quotes/${context.quote.id}`;
  const saved = context.defaultAddress;

  const [fullName, setFullName] = React.useState(saved?.fullName ?? '');
  const [phone, setPhone] = React.useState(saved?.phone ?? context.phone ?? '');
  const [line1, setLine1] = React.useState(saved?.line1 ?? '');
  const [line2, setLine2] = React.useState(saved?.line2 ?? '');
  const [city, setCity] = React.useState(saved?.city ?? '');
  const [province, setProvince] = React.useState(saved?.state ?? '');
  const [postalCode, setPostalCode] = React.useState(saved?.postalCode ?? '');
  const [rateId, setRateId] = React.useState<string | null>(null);
  const [payment, setPayment] = React.useState<Payment>('COD');
  const [note, setNote] = React.useState('');
  const [accepted, setAccepted] = React.useState(false);

  const [preview, setPreview] = React.useState<QuoteCheckoutPreview | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Issue[]>([]);
  const [isPlacing, setIsPlacing] = React.useState(false);

  // Re-price whenever something that changes the total changes.
  React.useEffect(() => {
    if (!province || city.trim().length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${base}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            country: 'PK',
            state: province,
            city: city.trim(),
            shippingRateId: rateId,
            paymentMethod: payment,
          }),
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => null)) as
          (QuoteCheckoutPreview & { error?: string }) | null;
        if (!response.ok || !data) throw new Error(data?.error ?? 'Could not price the delivery.');

        setPreview(data);
        setPreviewError(null);
        if (!rateId && data.selectedRateId) setRateId(data.selectedRateId);
        if (!data.codAllowed && payment === 'COD') setPayment('BANK_TRANSFER');
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        setPreviewError(error instanceof Error ? error.message : 'Could not price the delivery.');
      }
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [base, city, province, rateId, payment]);

  const errorFor = (field: string) =>
    errors.find((error) => error.field === field || error.field.endsWith(`.${field}`))?.message;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors([]);
    setIsPlacing(true);

    try {
      const response = await fetch(`${base}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          shippingAddress: {
            fullName,
            phone,
            line1,
            line2: line2 || undefined,
            city,
            state: province,
            postalCode: postalCode || undefined,
            country: 'PK',
            type: 'SHIPPING',
          },
          shippingRateId: rateId,
          paymentMethod: payment,
          customerNote: note || undefined,
          acceptTerms: accepted,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        orderNumber?: string;
        error?: string;
        issues?: Issue[];
        details?: Issue[];
      } | null;

      if (!response.ok || !data?.orderNumber) {
        const issues = data?.issues ?? data?.details;
        if (Array.isArray(issues)) setErrors(issues);
        throw new Error(data?.error ?? 'Your order was not placed.');
      }

      router.push(`/order-confirmed/${data.orderNumber}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Your order was not placed.');
      setIsPlacing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
      <div className="space-y-6">
        <FormErrorSummary errors={errors} />

        <Card>
          <CardHeader>
            <CardTitle as="h2">Delivery address</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField label="Full name" id="q-fullName" required error={errorFor('fullName')}>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </FormField>
            <FormField label="Mobile number" id="q-phone" required error={errorFor('phone')}>
              <Input
                type="tel"
                inputMode="tel"
                placeholder="0300 1234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </FormField>
            <FormField
              label="Address"
              id="q-line1"
              required
              className="sm:col-span-2"
              error={errorFor('line1')}
            >
              <Input value={line1} onChange={(e) => setLine1(e.target.value)} required />
            </FormField>
            <FormField label="Apartment, area (optional)" id="q-line2" className="sm:col-span-2">
              <Input value={line2} onChange={(e) => setLine2(e.target.value)} />
            </FormField>
            <FormField label="City" id="q-city" required error={errorFor('city')}>
              <Input value={city} onChange={(e) => setCity(e.target.value)} required />
            </FormField>
            <SelectField
              label="Province"
              id="q-province"
              required
              value={province}
              onValueChange={setProvince}
              placeholder="Choose a province"
              options={PAKISTAN_PROVINCES}
              error={errorFor('state')}
            />
            <FormField label="Postal code (optional)" id="q-postal" error={errorFor('postalCode')}>
              <Input
                inputMode="numeric"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
              />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Delivery</CardTitle>
          </CardHeader>
          <CardContent>
            {!preview ? (
              <p className="text-sm text-muted-foreground">
                {previewError ?? 'Enter your city and province to see delivery options.'}
              </p>
            ) : preview.rates.length === 0 ? (
              <p className="text-sm text-destructive">
                We do not deliver to that address yet. Ask us about it in the conversation.
              </p>
            ) : (
              <fieldset className="space-y-2">
                <legend className="sr-only">Delivery option</legend>
                {preview.rates.map((option) => (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3"
                  >
                    <input
                      type="radio"
                      name="delivery"
                      className="mt-1 size-4 accent-primary"
                      checked={rateId === option.id}
                      onChange={() => setRateId(option.id)}
                    />
                    <span className="flex-1 text-sm">
                      <span className="font-medium">{option.name}</span>
                      <span className="block text-muted-foreground">
                        {option.minDays}–{option.maxDays} days after stitching
                        {option.description ? ` · ${option.description}` : ''}
                      </span>
                    </span>
                    <span className="text-sm tabular-nums">
                      {option.amount === 0 ? 'Free' : rs(option.amount)}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Payment</CardTitle>
          </CardHeader>
          <CardContent>
            <fieldset className="space-y-2">
              <legend className="sr-only">Payment method</legend>
              <label
                className={`flex items-start gap-3 rounded-md border p-3 ${preview && !preview.codAllowed ? 'opacity-60' : 'cursor-pointer'}`}
              >
                <input
                  type="radio"
                  name="payment"
                  className="mt-1 size-4 accent-primary"
                  checked={payment === 'COD'}
                  disabled={Boolean(preview && !preview.codAllowed)}
                  onChange={() => setPayment('COD')}
                />
                <span className="text-sm">
                  <span className="font-medium">Cash on delivery</span>
                  <span className="block text-muted-foreground">
                    {preview && !preview.codAllowed
                      ? 'Available on orders up to Rs 50,000.'
                      : 'Pay the courier when your order arrives.'}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                <input
                  type="radio"
                  name="payment"
                  className="mt-1 size-4 accent-primary"
                  checked={payment === 'BANK_TRANSFER'}
                  onChange={() => setPayment('BANK_TRANSFER')}
                />
                <span className="text-sm">
                  <span className="font-medium">Bank transfer</span>
                  <span className="block text-muted-foreground">
                    We send our bank details in the conversation, and start stitching once the
                    payment arrives.
                  </span>
                </span>
              </label>
            </fieldset>

            <FormField label="Note for us (optional)" id="q-note" className="mt-4">
              <Textarea
                rows={2}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </FormField>
          </CardContent>
        </Card>
      </div>

      <Card className="lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle as="h2">Your order</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium">{context.request.title}</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{context.request.number}</span> · ready in about{' '}
              {context.quote.stitchingDays} days
            </p>
          </div>

          <dl className="space-y-1.5">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Piece</dt>
              <dd className="tabular-nums">{rs(context.quote.amount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Delivery</dt>
              <dd className="tabular-nums">
                {preview ? (preview.shippingTotal === 0 ? 'Free' : rs(preview.shippingTotal)) : '—'}
              </dd>
            </div>
            {preview && preview.taxTotal > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tax</dt>
                <dd className="tabular-nums">{rs(preview.taxTotal)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{rs(preview?.grandTotal ?? context.quote.amount)}</dd>
            </div>
          </dl>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              I agree to the{' '}
              <Link href="/pages/terms" target="_blank" className="underline underline-offset-4">
                terms
              </Link>
              , including that a made-to-order piece cannot be cancelled once stitching begins.
            </span>
          </label>
          {errorFor('acceptTerms') && (
            <p role="alert" className="text-xs text-destructive">
              {errorFor('acceptTerms')}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            fullWidth
            isLoading={isPlacing}
            loadingText="Placing order"
            disabled={!preview || !rateId || preview.rates.length === 0}
          >
            Place order
          </Button>
          <p className="text-xs text-muted-foreground">
            Signed in as {context.email}. Your confirmation is sent there.
          </p>
        </CardContent>
      </Card>
    </form>
  );
}
