'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, SlidersHorizontal } from 'lucide-react';
import type { FacetGroup, ProductFacets } from '@momishop/shared/api-types';
import { formatMoney } from '@momishop/shared/money';
import type { ProductFilter } from '@momishop/shared/validation';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * The storefront filter panel.
 *
 * Which groups appear, what they are called and their order are set by staff
 * under Admin → Filters, so the panel renders whatever the API sends rather
 * than a fixed list. Categories are not here — they are the site navigation.
 *
 * Choices are collected into a draft and only take effect on Apply. Applying
 * each tick instantly re-rendered the grid under the shopper's thumb on every
 * tap, which on a phone reads as the page jumping about; one confirmed change
 * is calmer and costs one request instead of five.
 *
 * Applied filters live in the URL, so a filtered view is shareable and
 * survives the back button. The listing page keys this component by the
 * applied query, so an unapplied draft is discarded whenever the URL changes
 * underneath it.
 */

type Fit = NonNullable<ProductFilter['fit']> | '';

interface Draft {
  colors: string[];
  fabrics: string[];
  /** Custom filter choices as `filter:option` slug pairs. */
  attrs: string[];
  minPrice: string;
  maxPrice: string;
  fit: Fit;
}

const EMPTY: Draft = { colors: [], fabrics: [], attrs: [], minPrice: '', maxPrice: '', fit: '' };

/** Every query key this panel owns; anything else (category, search, sort) is left alone. */
const FILTER_KEYS = [
  'colors',
  'fabrics',
  'fabric',
  'attrs',
  'minPrice',
  'maxPrice',
  'fit',
  'cursor',
];

const FIT_CHOICES: { value: Fit; label: string }[] = [
  { value: '', label: 'Any' },
  { value: 'made-to-measure', label: 'Stitched to my measurements' },
  { value: 'ready-made', label: 'Ready-made' },
];

function draftFrom(current: ProductFilter): Draft {
  return {
    colors: current.colors ?? [],
    fabrics: [...(current.fabrics ?? []), ...(current.fabric ? [current.fabric] : [])],
    attrs: current.attrs ?? [],
    // Rupees for display; the URL and API carry paisa.
    minPrice: current.minPrice !== undefined ? String(current.minPrice / 100) : '',
    maxPrice: current.maxPrice !== undefined ? String(current.maxPrice / 100) : '',
    fit: current.fit ?? '',
  };
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function toggled(list: string[], value: string): string[] {
  return list.some((entry) => same(entry, value))
    ? list.filter((entry) => !same(entry, value))
    : [...list, value];
}

function CheckRow({
  label,
  count,
  checked,
  onToggle,
}: {
  label: string;
  count: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 shrink-0 rounded border-input accent-primary"
        checked={checked}
        onChange={onToggle}
      />
      <span className="flex-1">{label}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
    </label>
  );
}

export function ProductFilters({
  facets,
  current,
}: {
  facets: ProductFacets;
  current: ProductFilter;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(current));
  const [priceError, setPriceError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();
  const toggleRef = React.useRef<HTMLDivElement>(null);

  const applied = draftFrom(current);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const activeCount =
    applied.colors.length +
    applied.fabrics.length +
    applied.attrs.length +
    (applied.minPrice || applied.maxPrice ? 1 : 0) +
    (applied.fit ? 1 : 0);

  /** Closes the mobile panel and returns the shopper to the results. */
  function showResults() {
    if (!open) return;
    setOpen(false);
    toggleRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function navigate(next: Draft) {
    const params = new URLSearchParams(searchParams.toString());
    // Any filter change resets pagination; keeping a stale cursor would show
    // page 3 of a result set the shopper has never seen page 1 of.
    for (const key of FILTER_KEYS) params.delete(key);

    for (const colour of next.colors) params.append('colors', colour);
    for (const fabric of next.fabrics) params.append('fabrics', fabric);
    for (const pair of next.attrs) params.append('attrs', pair);
    if (next.minPrice) params.set('minPrice', String(Math.round(Number(next.minPrice) * 100)));
    if (next.maxPrice) params.set('maxPrice', String(Math.round(Number(next.maxPrice) * 100)));
    if (next.fit) params.set('fit', next.fit);

    startTransition(() => {
      router.push(params.size > 0 ? `/products?${params}` : '/products', { scroll: false });
    });
    showResults();
  }

  function handleApply(event: React.FormEvent) {
    event.preventDefault();

    if (draft.minPrice && draft.maxPrice && Number(draft.minPrice) > Number(draft.maxPrice)) {
      setPriceError('The minimum price is higher than the maximum.');
      return;
    }
    setPriceError(null);

    // Nothing changed: Apply just closes the panel rather than reloading.
    if (!isDirty) {
      showResults();
      return;
    }
    navigate(draft);
  }

  function handleClear() {
    setDraft(EMPTY);
    setPriceError(null);
    navigate(EMPTY);
  }

  function toggle(key: 'colors' | 'fabrics' | 'attrs', value: string) {
    setDraft((value_) => ({ ...value_, [key]: toggled(value_[key], value) }));
  }

  function renderGroup(group: FacetGroup) {
    switch (group.kind) {
      case 'COLOR':
        return (
          <fieldset key="color">
            <legend className="mb-3 text-sm font-medium">{group.label}</legend>
            <ul className="flex flex-wrap gap-2">
              {group.colors.map((colour) => {
                const checked = draft.colors.some((entry) => same(entry, colour.name));

                return (
                  <li key={colour.name}>
                    <label
                      className={cn(
                        'flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm transition-colors',
                        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2',
                        checked ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => toggle('colors', colour.name)}
                      />
                      <span
                        aria-hidden="true"
                        className="flex size-4 shrink-0 items-center justify-center rounded-full border border-foreground/20"
                        style={{ backgroundColor: colour.hex ?? undefined }}
                      >
                        {checked && <Check className="size-3 text-white mix-blend-difference" />}
                      </span>
                      {colour.name}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );

      case 'PRICE':
        return (
          <fieldset key="price">
            <legend className="mb-3 text-sm font-medium">{group.label}</legend>
            <div className="flex items-center gap-2">
              <FormField label="Minimum price" id="filter-min-price" hideLabel className="flex-1">
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="Min"
                  value={draft.minPrice}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      minPrice: event.target.value.replace(/\D/g, ''),
                    }))
                  }
                />
              </FormField>
              <span aria-hidden="true" className="text-muted-foreground">
                –
              </span>
              <FormField label="Maximum price" id="filter-max-price" hideLabel className="flex-1">
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="Max"
                  value={draft.maxPrice}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      maxPrice: event.target.value.replace(/\D/g, ''),
                    }))
                  }
                />
              </FormField>
            </div>
            {priceError ? (
              <p role="alert" className="mt-2 text-xs font-medium text-destructive">
                {priceError}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                From {formatMoney(group.min, 'PKR')} to {formatMoney(group.max, 'PKR')}
              </p>
            )}
          </fieldset>
        );

      case 'FABRIC':
        return (
          <fieldset key="fabric">
            <legend className="mb-3 text-sm font-medium">{group.label}</legend>
            <ul className="space-y-1">
              {group.fabrics.map((fabric) => (
                <li key={fabric.name}>
                  <CheckRow
                    label={fabric.name}
                    count={fabric.count}
                    checked={draft.fabrics.some((entry) => same(entry, fabric.name))}
                    onToggle={() => toggle('fabrics', fabric.name)}
                  />
                </li>
              ))}
            </ul>
          </fieldset>
        );

      case 'FIT':
        return (
          <fieldset key="fit">
            <legend className="mb-3 text-sm font-medium">{group.label}</legend>
            <div className="space-y-1">
              {FIT_CHOICES.map((fit) => (
                <label
                  key={fit.value || 'any'}
                  className="flex min-h-9 cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="fit"
                    className="size-4 shrink-0 accent-primary"
                    checked={draft.fit === fit.value}
                    onChange={() => setDraft((value) => ({ ...value, fit: fit.value }))}
                  />
                  {fit.label}
                </label>
              ))}
            </div>
          </fieldset>
        );

      case 'ATTRIBUTE':
        return (
          <fieldset key={`attr-${group.slug}`}>
            <legend className="mb-3 text-sm font-medium">{group.label}</legend>
            <ul className="space-y-1">
              {group.options.map((option) => {
                const pair = `${group.slug}:${option.slug}`;
                return (
                  <li key={option.slug}>
                    <CheckRow
                      label={option.label}
                      count={option.count}
                      checked={draft.attrs.includes(pair)}
                      onToggle={() => toggle('attrs', pair)}
                    />
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );

      default:
        return null;
    }
  }

  const hasGroups = facets.filters.length > 0;

  return (
    <>
      {/* Mobile toggle */}
      <div ref={toggleRef} className="scroll-mt-20 lg:hidden">
        <Button
          variant="outline"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="product-filters"
          aria-busy={isPending || undefined}
          fullWidth
        >
          <SlidersHorizontal aria-hidden="true" />
          {isPending ? 'Updating…' : 'Filters'}
          {!isPending && activeCount > 0 && ` (${activeCount})`}
        </Button>
      </div>

      <form
        id="product-filters"
        aria-label="Product filters"
        onSubmit={handleApply}
        className={cn('space-y-6', !open && 'hidden lg:block')}
      >
        {hasGroups ? (
          facets.filters.map(renderGroup)
        ) : (
          <p className="text-sm text-muted-foreground">No filters for these pieces yet.</p>
        )}

        {(hasGroups || activeCount > 0) && (
          /*
            Sticky on mobile so Apply stays under the thumb however long the
            lists grow.
          */
          <div className="sticky bottom-0 flex gap-2 border-t bg-background py-3 lg:static lg:border-0 lg:py-0">
            <Button type="submit" className="flex-1" isLoading={isPending} loadingText="Applying">
              Apply filters
            </Button>
            {(activeCount > 0 || isDirty) && (
              <Button type="button" variant="ghost" onClick={handleClear}>
                Clear
              </Button>
            )}
          </div>
        )}
      </form>
    </>
  );
}
