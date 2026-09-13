'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ProductFilter } from '@momishop/shared/validation';
import { SelectField } from '@/components/ui/select-field';

/**
 * Sort order, applied as soon as it is picked.
 *
 * Unlike the filters, sorting hides nothing, so there is nothing to confirm;
 * making it wait for an Apply button would only add a tap.
 */

const SORT_OPTIONS: { value: ProductFilter['sort']; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'popular', label: 'Most popular' },
  { value: 'rating', label: 'Best rated' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
];

export function ProductSort({ value }: { value: ProductFilter['sort'] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();

  return (
    <SelectField
      label="Sort by"
      id="product-sort"
      className="w-full sm:w-56"
      value={value}
      onValueChange={(next) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('sort', next);
        params.delete('cursor');
        startTransition(() => router.push(`/products?${params}`, { scroll: false }));
      }}
      options={SORT_OPTIONS}
    />
  );
}
