'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import type { AdminCategory, AdminCoupon, CouponType } from '@momishop/shared/api-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormErrorSummary, FormField } from '@/components/ui/form-field';
import { Input, Textarea } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select-field';

/**
 * The coupon editor, for new and existing codes.
 *
 * Amounts are entered in rupees and sent in paisa; a percentage is sent as the
 * percent itself. Dates are whole days in Pakistan time — a code that "ends on
 * the 31st" should still work at 11pm on the 31st in Lahore, whatever time
 * zone the server or the admin's laptop happens to be in. Formatting them with
 * an explicit time zone also keeps the server and browser renders identical.
 *
 * Once a code has been used its terms are locked by the API; the form shows
 * that up front rather than letting someone edit and then refusing the save.
 */

const SHOP_TIME_ZONE = 'Asia/Karachi';
const SHOP_UTC_OFFSET = '+05:00';

const TYPE_OPTIONS: { value: CouponType; label: string }[] = [
  { value: 'PERCENTAGE', label: 'Percentage off' },
  { value: 'FIXED_AMOUNT', label: 'Fixed amount off' },
  { value: 'FREE_SHIPPING', label: 'Free delivery' },
];

const toMajor = (minor: number | null | undefined) =>
  minor === null || minor === undefined ? '' : String(minor / 100);
const toMinor = (major: string) => Math.round(Number(major || '0') * 100);
const digits = (value: string) => value.replace(/[^\d.]/g, '');

/** An ISO timestamp as the calendar day it falls on in Pakistan. */
function shopDay(iso: string | null): string {
  if (!iso) return '';
  // en-CA formats as YYYY-MM-DD, which is what a date input expects.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function CouponForm({
  coupon,
  categories,
  canEdit,
}: {
  coupon: AdminCoupon | null;
  categories: AdminCategory[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const isNew = coupon === null;
  const locked = !isNew && coupon.usedCount > 0;

  const [code, setCode] = React.useState(coupon?.code ?? '');
  const [type, setType] = React.useState<CouponType>(coupon?.type ?? 'PERCENTAGE');
  const [percent, setPercent] = React.useState(
    coupon?.type === 'PERCENTAGE' ? String(coupon.value) : '',
  );
  const [amount, setAmount] = React.useState(
    coupon?.type === 'FIXED_AMOUNT' ? toMajor(coupon.value) : '',
  );
  const [maxDiscount, setMaxDiscount] = React.useState(toMajor(coupon?.maxDiscount));
  const [minOrder, setMinOrder] = React.useState(
    coupon && coupon.minOrderSubtotal > 0 ? toMajor(coupon.minOrderSubtotal) : '',
  );
  const [usageLimit, setUsageLimit] = React.useState(
    coupon?.usageLimit ? String(coupon.usageLimit) : '',
  );
  const [perCustomer, setPerCustomer] = React.useState(
    coupon ? (coupon.usageLimitPerUser ? String(coupon.usageLimitPerUser) : '') : '1',
  );
  const [categoryIds, setCategoryIds] = React.useState<string[]>(
    coupon?.appliesToCategoryIds ?? [],
  );
  const [firstOrderOnly, setFirstOrderOnly] = React.useState(coupon?.firstOrderOnly ?? false);
  const [description, setDescription] = React.useState(coupon?.description ?? '');
  const [isActive, setIsActive] = React.useState(coupon?.isActive ?? true);
  const [startDay, setStartDay] = React.useState(shopDay(coupon?.startsAt ?? null));
  const [endDay, setEndDay] = React.useState(shopDay(coupon?.endsAt ?? null));

  const [errors, setErrors] = React.useState<{ field: string; message: string }[]>([]);
  const [isPending, setIsPending] = React.useState(false);

  const errorFor = (field: string) => errors.find((error) => error.field === field)?.message;
  const readOnly = !canEdit;
  const termsDisabled = readOnly || locked;

  function value(): number {
    if (type === 'PERCENTAGE') return Number(percent || '0');
    if (type === 'FIXED_AMOUNT') return toMinor(amount);
    // Free delivery carries no amount. An existing code keeps whatever it had,
    // so re-saving a used one is not mistaken for a change to its terms.
    return coupon?.type === 'FREE_SHIPPING' ? coupon.value : 0;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors([]);

    if (startDay && endDay && endDay < startDay) {
      setErrors([{ field: 'endsAt', message: 'The end date must come after the start date.' }]);
      return;
    }

    setIsPending(true);

    const payload = {
      code,
      type,
      value: value(),
      maxDiscount: type === 'PERCENTAGE' && maxDiscount ? toMinor(maxDiscount) : null,
      minOrderSubtotal: minOrder ? toMinor(minOrder) : 0,
      usageLimit: usageLimit ? Number(usageLimit) : null,
      usageLimitPerUser: perCustomer ? Number(perCustomer) : null,
      appliesToCategoryIds: categoryIds,
      // Product-level limits are not edited here; they are carried through untouched.
      appliesToProductIds: coupon?.appliesToProductIds ?? [],
      firstOrderOnly,
      description: description || undefined,
      isActive,
      // Whole days in Pakistan time: from the first moment of the start day to
      // the last moment of the end day.
      startsAt: startDay ? `${startDay}T00:00:00${SHOP_UTC_OFFSET}` : null,
      endsAt: endDay ? `${endDay}T23:59:59${SHOP_UTC_OFFSET}` : null,
    };

    try {
      const response = await fetch(
        isNew ? '/api/admin/coupons' : `/api/admin/coupons/${coupon.id}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      const body = (await response.json().catch(() => null)) as {
        error?: string;
        issues?: { field: string; message: string }[];
        details?: { field: string; message: string }[];
        coupon?: { id: string };
      } | null;

      if (!response.ok) {
        const issues = body?.issues ?? body?.details;
        if (Array.isArray(issues)) setErrors(issues);
        throw new Error(body?.error ?? 'We could not save this coupon.');
      }

      toast.success(isNew ? 'Coupon created.' : 'Coupon saved.');
      if (isNew && body?.coupon) {
        router.push(`/admin/coupons/${body.coupon.id}`);
      } else {
        router.refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'We could not save this coupon.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormErrorSummary errors={errors} />

      {locked && (
        <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            This code has been used {coupon.usedCount} time{coupon.usedCount === 1 ? '' : 's'}, so
            its discount and conditions are locked. You can still change its dates, limits and
            description, or switch it off.
          </span>
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">The discount</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                label="Code"
                id="coupon-code"
                required
                hint="What shoppers type at checkout. Letters, numbers, hyphens."
                error={errorFor('code')}
              >
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  maxLength={32}
                  className="font-mono uppercase"
                  disabled={termsDisabled}
                  required
                />
              </FormField>

              <SelectField
                label="Type"
                id="coupon-type"
                value={type}
                onValueChange={(next) => setType(next as CouponType)}
                options={TYPE_OPTIONS}
                disabled={termsDisabled}
              />

              {type === 'PERCENTAGE' && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label="Percent off"
                    id="coupon-percent"
                    required
                    error={errorFor('value')}
                  >
                    <Input
                      inputMode="numeric"
                      value={percent}
                      onChange={(event) => setPercent(event.target.value.replace(/\D/g, ''))}
                      disabled={termsDisabled}
                      required
                    />
                  </FormField>
                  <FormField
                    label="Largest discount (Rs)"
                    id="coupon-max"
                    hint="Leave empty for no cap."
                    error={errorFor('maxDiscount')}
                  >
                    <Input
                      inputMode="decimal"
                      value={maxDiscount}
                      onChange={(event) => setMaxDiscount(digits(event.target.value))}
                      disabled={termsDisabled}
                    />
                  </FormField>
                </div>
              )}

              {type === 'FIXED_AMOUNT' && (
                <FormField
                  label="Amount off (Rs)"
                  id="coupon-amount"
                  required
                  error={errorFor('value')}
                >
                  <Input
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(digits(event.target.value))}
                    disabled={termsDisabled}
                    required
                  />
                </FormField>
              )}

              {type === 'FREE_SHIPPING' && (
                <p className="text-sm text-muted-foreground">
                  Delivery is free on any order this code is used on.
                </p>
              )}

              <FormField
                label="Description"
                id="coupon-description"
                hint="For staff; shoppers do not see it."
              >
                <Textarea
                  rows={2}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={readOnly}
                />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Who can use it</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                label="Minimum order (Rs)"
                id="coupon-min-order"
                hint="Leave empty for any order size."
                error={errorFor('minOrderSubtotal')}
              >
                <Input
                  inputMode="decimal"
                  value={minOrder}
                  onChange={(event) => setMinOrder(digits(event.target.value))}
                  disabled={termsDisabled}
                />
              </FormField>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input accent-primary"
                  checked={firstOrderOnly}
                  onChange={(event) => setFirstOrderOnly(event.target.checked)}
                  disabled={termsDisabled}
                />
                First order only
              </label>

              <fieldset>
                <legend className="mb-2 text-sm font-medium">Categories</legend>
                <p className="mb-2 text-xs text-muted-foreground">
                  Tick none and the code works across the whole shop.
                </p>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {categories.map((category) => (
                    <label key={category.id} className="flex min-h-9 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input accent-primary"
                        checked={categoryIds.includes(category.id)}
                        onChange={() =>
                          setCategoryIds((current) =>
                            current.includes(category.id)
                              ? current.filter((id) => id !== category.id)
                              : [...current, category.id],
                          )
                        }
                        disabled={termsDisabled}
                      />
                      {category.name}
                    </label>
                  ))}
                </div>
                {(coupon?.appliesToProductIds.length ?? 0) > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Also limited to {coupon?.appliesToProductIds.length} specific product
                    {coupon?.appliesToProductIds.length === 1 ? '' : 's'}.
                  </p>
                )}
              </fieldset>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">When</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input accent-primary"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                  disabled={readOnly}
                />
                Switched on
              </label>

              <FormField
                label="Starts"
                id="coupon-starts"
                hint="Pakistan time. Empty starts now."
                error={errorFor('startsAt')}
              >
                <Input
                  type="date"
                  value={startDay}
                  onChange={(event) => setStartDay(event.target.value)}
                  disabled={readOnly}
                />
              </FormField>

              <FormField
                label="Ends"
                id="coupon-ends"
                hint="Works until the end of this day. Empty never ends."
                error={errorFor('endsAt')}
              >
                <Input
                  type="date"
                  value={endDay}
                  onChange={(event) => setEndDay(event.target.value)}
                  disabled={readOnly}
                />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Limits</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                label="Total uses"
                id="coupon-usage-limit"
                hint="Empty for unlimited."
                error={errorFor('usageLimit')}
              >
                <Input
                  inputMode="numeric"
                  value={usageLimit}
                  onChange={(event) => setUsageLimit(event.target.value.replace(/\D/g, ''))}
                  disabled={readOnly}
                />
              </FormField>

              <FormField
                label="Uses per customer"
                id="coupon-per-customer"
                hint="Empty for unlimited."
                error={errorFor('usageLimitPerUser')}
              >
                <Input
                  inputMode="numeric"
                  value={perCustomer}
                  onChange={(event) => setPerCustomer(event.target.value.replace(/\D/g, ''))}
                  disabled={readOnly}
                />
              </FormField>

              {!isNew && (
                <p className="text-sm text-muted-foreground">
                  Used {coupon.usedCount} time{coupon.usedCount === 1 ? '' : 's'} so far.
                </p>
              )}
            </CardContent>
          </Card>

          {canEdit && (
            <Button type="submit" fullWidth size="lg" isLoading={isPending} loadingText="Saving">
              {isNew ? 'Create coupon' : 'Save changes'}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
