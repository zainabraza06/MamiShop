'use client';

import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Banknote, CreditCard, Lock, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { FormField, FormErrorSummary } from '@/components/ui/form-field';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatMoney, type Currency } from '@/lib/money';
import { addBusinessDays, formatDate, cn } from '@/lib/utils';
import { PAKISTAN_PROVINCES } from '@/lib/regions';

/**
 * Checkout.
 *
 * The order total is never computed in the browser. Every change to the
 * address, delivery option, coupon or loyalty redemption re-quotes against
 * /api/checkout/quote, which shares its pricing code with order placement.
 * A client-side total would eventually disagree with what is charged, and the
 * customer would be right to be angry about it.
 *
 * Quotes are debounced so typing a city name issues one request, not eight.
 */

interface CheckoutLine {
  id: string;
  quantity: number;
  productName: string;
  variantName: string | null;
  unitPrice: number;
  imageUrl: string | null;
  imageAlt: string;
}

interface SavedAddress {
  id: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string | null;
  country: string;
  isDefault: boolean;
}

interface ShippingRateOption {
  id: string;
  name: string;
  description: string | null;
  amount: number;
  freeAbove: number | null;
  minDays: number;
  maxDays: number;
}

interface PricingBreakdown {
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  loyaltyApplied: number;
  grandTotal: number;
  breakdown: { label: string; amount: number; kind: 'charge' | 'credit' }[];
}

type PaymentMethod = 'COD' | 'STRIPE' | 'JAZZCASH' | 'EASYPAISA' | 'BANK_TRANSFER';

const PAYMENT_OPTIONS: {
  value: PaymentMethod;
  label: string;
  description: string;
  icon: typeof CreditCard;
}[] = [
  {
    value: 'COD',
    label: 'Cash on delivery',
    description: 'Pay the courier when your parcel arrives. A handling fee applies.',
    icon: Banknote,
  },
  {
    value: 'STRIPE',
    label: 'Card',
    description: 'Visa, Mastercard. Processed securely by Stripe.',
    icon: CreditCard,
  },
  {
    value: 'JAZZCASH',
    label: 'JazzCash',
    description: 'Pay from your JazzCash mobile account.',
    icon: Smartphone,
  },
  {
    value: 'EASYPAISA',
    label: 'Easypaisa',
    description: 'Pay from your Easypaisa mobile account.',
    icon: Smartphone,
  },
];

export function CheckoutForm({
  lines,
  currency: currencyCode,
  savedAddresses,
  loyaltyBalance,
  loyaltyEnabled,
  user,
  appliedCouponCode,
  maxStitchingDays,
}: {
  lines: CheckoutLine[];
  currency: string;
  savedAddresses: SavedAddress[];
  loyaltyBalance: number;
  loyaltyEnabled: boolean;
  user: { email: string; name: string | null; id: string } | null;
  appliedCouponCode: string | null;
  maxStitchingDays: number;
}) {
  const router = useRouter();
  const currency = currencyCode as Currency;
  const defaultAddress = savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0];

  const [email, setEmail] = React.useState(user?.email ?? '');
  const [phone, setPhone] = React.useState(defaultAddress?.phone ?? '');
  const [fullName, setFullName] = React.useState(defaultAddress?.fullName ?? user?.name ?? '');
  const [line1, setLine1] = React.useState(defaultAddress?.line1 ?? '');
  const [line2, setLine2] = React.useState(defaultAddress?.line2 ?? '');
  const [city, setCity] = React.useState(defaultAddress?.city ?? '');
  const [state, setState] = React.useState(defaultAddress?.state ?? '');
  const [postalCode, setPostalCode] = React.useState(defaultAddress?.postalCode ?? '');
  const [note, setNote] = React.useState('');

  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>('COD');
  const [shippingRateId, setShippingRateId] = React.useState<string | null>(null);
  const [couponInput, setCouponInput] = React.useState(appliedCouponCode ?? '');
  const [appliedCoupon, setAppliedCoupon] = React.useState(appliedCouponCode ?? '');
  const [loyaltyPoints, setLoyaltyPoints] = React.useState(0);

  const [saveAddress, setSaveAddress] = React.useState(Boolean(user));
  const [createAccount, setCreateAccount] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [acceptTerms, setAcceptTerms] = React.useState(false);

  const [pricing, setPricing] = React.useState<PricingBreakdown | null>(null);
  const [rates, setRates] = React.useState<ShippingRateOption[]>([]);
  const [couponError, setCouponError] = React.useState<string | null>(null);
  const [isQuoting, setIsQuoting] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<{ field: string; message: string }[]>([]);

  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  /**
   * Re-quote whenever anything price-affecting changes.
   *
   * Debounced by 400ms, and every response is checked against a request
   * sequence number so a slow earlier quote cannot overwrite a newer one.
   */
  const requestSeq = React.useRef(0);

  React.useEffect(() => {
    const seq = ++requestSeq.current;

    const timer = setTimeout(async () => {
      setIsQuoting(true);
      try {
        const response = await fetch('/api/checkout/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            country: 'PK',
            state,
            city,
            shippingRateId,
            couponCode: appliedCoupon || null,
            paymentMethod,
            loyaltyPoints,
          }),
        });

        if (!response.ok) throw new Error('Could not calculate your total');
        const body = (await response.json()) as {
          pricing: PricingBreakdown;
          rates: ShippingRateOption[];
          selectedRateId: string | null;
          couponError: string | null;
        };

        // A stale response from an earlier keystroke must not win.
        if (seq !== requestSeq.current) return;

        setPricing(body.pricing);
        setRates(body.rates);
        setCouponError(body.couponError);
        if (!shippingRateId && body.selectedRateId) setShippingRateId(body.selectedRateId);
      } catch {
        if (seq === requestSeq.current) setPricing(null);
      } finally {
        if (seq === requestSeq.current) setIsQuoting(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [state, city, shippingRateId, appliedCoupon, paymentMethod, loyaltyPoints]);

  const selectedRate = rates.find((r) => r.id === shippingRateId);
  const maxRedeemablePoints = Math.min(
    loyaltyBalance,
    // One point is worth Rs 1, so never offer to redeem more than the order.
    Math.floor((pricing?.grandTotal ?? subtotal) / 100),
  );

  function validate(): { field: string; message: string }[] {
    const found: { field: string; message: string }[] = [];
    if (!email.includes('@')) found.push({ field: 'email', message: 'Enter a valid email address.' });
    if (!/^0?3\d{9}$/.test(phone.replace(/\D/g, '').replace(/^92/, '0')))
      found.push({ field: 'phone', message: 'Enter a valid Pakistani mobile number.' });
    if (fullName.trim().length < 2)
      found.push({ field: 'fullName', message: 'Enter the recipient name.' });
    if (line1.trim().length < 5)
      found.push({ field: 'line1', message: 'Enter a street address.' });
    if (city.trim().length < 2) found.push({ field: 'city', message: 'Enter a city.' });
    if (!state) found.push({ field: 'state', message: 'Select a province.' });
    if (!shippingRateId)
      found.push({ field: 'shipping', message: 'Choose a delivery option.' });
    if (createAccount && password.length < 10)
      found.push({ field: 'password', message: 'Use at least 10 characters for your password.' });
    if (!acceptTerms)
      found.push({ field: 'acceptTerms', message: 'Please accept the terms to place your order.' });
    return found;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const found = validate();
    setErrors(found);
    if (found.length > 0) return;

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          phone,
          shippingAddress: {
            fullName,
            phone,
            line1,
            line2: line2 || undefined,
            city,
            state,
            postalCode: postalCode || undefined,
            country: 'PK',
            type: 'SHIPPING',
            isDefault: savedAddresses.length === 0,
          },
          billingSameAsShipping: true,
          shippingRateId,
          paymentMethod,
          couponCode: appliedCoupon || undefined,
          loyaltyPoints,
          customerNote: note || undefined,
          saveAddress,
          createAccount,
          password: createAccount ? password : undefined,
          acceptTerms: true,
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        error?: string;
        issues?: { field: string; message: string }[];
        redirectTo?: string;
      } | null;

      if (!response.ok) {
        if (body?.issues) setErrors(body.issues);
        throw new Error(body?.error ?? 'We could not place your order.');
      }

      if (body?.redirectTo) router.push(body.redirectTo);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'We could not place your order.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const estimatedDelivery = selectedRate
    ? {
        earliest: addBusinessDays(new Date(), maxStitchingDays + selectedRate.minDays),
        latest: addBusinessDays(new Date(), maxStitchingDays + selectedRate.maxDays),
      }
    : null;

  return (
    <form onSubmit={handleSubmit} className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
      <div className="space-y-8">
        <FormErrorSummary errors={errors} />

        {/* Contact */}
        <section aria-labelledby="contact-heading">
          <h2 id="contact-heading" className="font-serif text-lg font-semibold">
            Contact
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField
              label="Email"
              id="email"
              required
              error={errors.find((e) => e.field === 'email')?.message}
              hint="We send your order confirmation and tracking here."
            >
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>

            <FormField
              label="Mobile number"
              id="phone"
              required
              error={errors.find((e) => e.field === 'phone')?.message}
              hint="The courier will call this number."
            >
              <Input
                type="tel"
                autoComplete="tel"
                placeholder="0300 1234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </FormField>
          </div>
        </section>

        {/* Delivery address */}
        <section aria-labelledby="address-heading">
          <h2 id="address-heading" className="font-serif text-lg font-semibold">
            Delivery address
          </h2>

          {savedAddresses.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {savedAddresses.map((address) => (
                <button
                  key={address.id}
                  type="button"
                  onClick={() => {
                    setFullName(address.fullName);
                    setPhone(address.phone);
                    setLine1(address.line1);
                    setLine2(address.line2 ?? '');
                    setCity(address.city);
                    setState(address.state);
                    setPostalCode(address.postalCode ?? '');
                  }}
                  className="min-h-10 rounded-md border px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {address.line1}, {address.city}
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <FormField
              label="Full name"
              id="fullName"
              required
              className="sm:col-span-2"
              error={errors.find((e) => e.field === 'fullName')?.message}
            >
              <Input
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </FormField>

            <FormField
              label="Address"
              id="line1"
              required
              className="sm:col-span-2"
              error={errors.find((e) => e.field === 'line1')?.message}
            >
              <Input
                autoComplete="address-line1"
                placeholder="House number and street"
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
              />
            </FormField>

            <FormField label="Apartment, area (optional)" id="line2" className="sm:col-span-2">
              <Input
                autoComplete="address-line2"
                value={line2}
                onChange={(e) => setLine2(e.target.value)}
              />
            </FormField>

            <FormField
              label="City"
              id="city"
              required
              error={errors.find((e) => e.field === 'city')?.message}
            >
              <Input
                autoComplete="address-level2"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </FormField>

            <FormField
              label="Province"
              id="state"
              required
              error={errors.find((e) => e.field === 'state')?.message}
            >
              <Select value={state} onValueChange={setState}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a province" />
                </SelectTrigger>
                <SelectContent>
                  {PAKISTAN_PROVINCES.map((province) => (
                    <SelectItem key={province} value={province}>
                      {province}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Postal code (optional)" id="postalCode">
              <Input
                autoComplete="postal-code"
                inputMode="numeric"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
              />
            </FormField>
          </div>

          {user && (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={saveAddress}
                onChange={(e) => setSaveAddress(e.target.checked)}
                className="size-4 rounded border-input"
              />
              Save this address for next time
            </label>
          )}
        </section>

        {/* Delivery method */}
        <section aria-labelledby="shipping-heading">
          <h2 id="shipping-heading" className="font-serif text-lg font-semibold">
            Delivery
          </h2>

          {rates.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {city && state
                ? 'No delivery options for that address yet.'
                : 'Enter your city and province to see delivery options.'}
            </p>
          ) : (
            <fieldset className="mt-4 space-y-2">
              <legend className="sr-only">Choose a delivery option</legend>
              {rates.map((rate) => {
                const isFree = rate.freeAbove !== null && subtotal >= rate.freeAbove;
                return (
                  <label
                    key={rate.id}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors',
                      shippingRateId === rate.id ? 'border-primary bg-accent' : 'hover:bg-accent/50',
                    )}
                  >
                    <input
                      type="radio"
                      name="shippingRate"
                      value={rate.id}
                      checked={shippingRateId === rate.id}
                      onChange={() => setShippingRateId(rate.id)}
                      className="mt-1 size-4"
                    />
                    <span className="flex-1">
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{rate.name}</span>
                        <span className="font-medium">
                          {isFree ? 'Free' : formatMoney(rate.amount, currency)}
                        </span>
                      </span>
                      {rate.description && (
                        <span className="mt-0.5 block text-sm text-muted-foreground">
                          {rate.description}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}

          {estimatedDelivery && (
            <p className="mt-3 text-sm text-muted-foreground">
              Stitching takes about {maxStitchingDays} working days. Estimated delivery{' '}
              <strong className="font-medium text-foreground">
                {formatDate(estimatedDelivery.earliest)} – {formatDate(estimatedDelivery.latest)}
              </strong>
              .
            </p>
          )}
        </section>

        {/* Payment */}
        <section aria-labelledby="payment-heading">
          <h2 id="payment-heading" className="font-serif text-lg font-semibold">
            Payment
          </h2>

          <fieldset className="mt-4 space-y-2">
            <legend className="sr-only">Choose a payment method</legend>
            {PAYMENT_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors',
                    paymentMethod === option.value
                      ? 'border-primary bg-accent'
                      : 'hover:bg-accent/50',
                  )}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={option.value}
                    checked={paymentMethod === option.value}
                    onChange={() => setPaymentMethod(option.value)}
                    className="mt-1 size-4"
                  />
                  <Icon className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
                  <span className="flex-1">
                    <span className="font-medium">{option.label}</span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" aria-hidden="true" />
            We never see or store your card details. Card payments are handled entirely by Stripe.
          </p>
        </section>

        {/* Order note */}
        <FormField label="Order note (optional)" id="note">
          <Textarea
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Delivery instructions, a landmark, a gift message…"
          />
        </FormField>

        {/* Guest account creation */}
        {!user && (
          <div className="rounded-md border p-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={createAccount}
                onChange={(e) => setCreateAccount(e.target.checked)}
                className="size-4 rounded border-input"
              />
              Create an account to track this order and save your measurements
            </label>

            {createAccount && (
              <div className="mt-4">
                <FormField
                  label="Choose a password"
                  id="password"
                  required
                  error={errors.find((e) => e.field === 'password')?.message}
                  hint="At least 10 characters."
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </FormField>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Summary */}
      <aside aria-labelledby="summary-heading" className="lg:sticky lg:top-24 lg:h-fit">
        <div className="rounded-lg border p-6">
          <h2 id="summary-heading" className="font-serif text-lg font-semibold">
            Your order
          </h2>

          <ul className="mt-4 space-y-3">
            {lines.map((line) => (
              <li key={line.id} className="flex gap-3">
                <div className="relative size-14 shrink-0 overflow-hidden rounded bg-muted">
                  {line.imageUrl && (
                    <Image src={line.imageUrl} alt={line.imageAlt} fill sizes="56px" className="object-cover" />
                  )}
                  <span className="absolute -end-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                    {line.quantity}
                  </span>
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-medium">{line.productName}</p>
                  {line.variantName && (
                    <p className="text-muted-foreground">{line.variantName}</p>
                  )}
                </div>
                <p className="text-sm font-medium">
                  {formatMoney(line.unitPrice * line.quantity, currency)}
                </p>
              </li>
            ))}
          </ul>

          <Separator className="my-4" />

          {/* Coupon */}
          <div className="flex gap-2">
            <FormField label="Discount code" id="coupon" hideLabel className="flex-1">
              <Input
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                placeholder="Discount code"
              />
            </FormField>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAppliedCoupon(couponInput.trim())}
            >
              Apply
            </Button>
          </div>

          {couponError && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {couponError}
            </p>
          )}
          {appliedCoupon && !couponError && (
            <Badge variant="success" className="mt-2">
              {appliedCoupon} applied
            </Badge>
          )}

          {/* Loyalty */}
          {loyaltyEnabled && loyaltyBalance > 0 && (
            <div className="mt-4">
              <FormField
                label={`Redeem points (${loyaltyBalance} available)`}
                id="loyalty"
                hint={`Up to ${maxRedeemablePoints} points on this order.`}
              >
                <Input
                  type="number"
                  min={0}
                  max={maxRedeemablePoints}
                  value={loyaltyPoints || ''}
                  onChange={(e) =>
                    setLoyaltyPoints(
                      Math.max(0, Math.min(maxRedeemablePoints, Number(e.target.value) || 0)),
                    )
                  }
                />
              </FormField>
            </div>
          )}

          <Separator className="my-4" />

          <dl aria-busy={isQuoting} className="space-y-2 text-sm">
            {(pricing?.breakdown ?? [{ label: 'Subtotal', amount: subtotal, kind: 'charge' as const }]).map(
              (row) => (
                <div key={row.label} className="flex justify-between">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className={cn(row.kind === 'credit' && 'text-success')}>
                    {row.kind === 'credit' && row.amount > 0 ? '−' : ''}
                    {formatMoney(row.amount, currency)}
                  </dd>
                </div>
              ),
            )}
          </dl>

          <Separator className="my-4" />

          <div className="flex items-baseline justify-between">
            <span className="font-medium">Total</span>
            <span className="font-serif text-xl font-semibold">
              {formatMoney(pricing?.grandTotal ?? subtotal, currency)}
            </span>
          </div>

          <label className="mt-6 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              className="mt-0.5 size-4 rounded border-input"
            />
            <span>
              I confirm my measurements are correct and accept the{' '}
              <a href="/pages/terms" className="underline underline-offset-4" target="_blank">
                terms
              </a>{' '}
              and{' '}
              <a
                href="/pages/returns-policy"
                className="underline underline-offset-4"
                target="_blank"
              >
                returns policy
              </a>
              .
            </span>
          </label>
          {errors.find((e) => e.field === 'acceptTerms') && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {errors.find((e) => e.field === 'acceptTerms')?.message}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            fullWidth
            className="mt-4"
            isLoading={isSubmitting}
            loadingText="Placing your order"
            disabled={isQuoting}
          >
            {paymentMethod === 'COD' ? 'Place order' : 'Continue to payment'}
          </Button>
        </div>
      </aside>
    </form>
  );
}
