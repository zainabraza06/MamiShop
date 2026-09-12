'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { SelectField } from '@/components/ui/select-field';
import { cn } from '@/lib/utils';
import type { CategoryNode } from '@momishop/shared/api-types';
import type { ProductFilter } from '@momishop/shared/validation';

/**
 * Catalogue filters.
 *
 * Filter state lives in the URL, not in component state. That makes a filtered
 * view shareable, bookmarkable, and correct when the back button is pressed —
 * all three break the moment you hold this in `useState`.
 *
 * Price inputs are debounced so typing "5000" issues one navigation rather
 * than four.
 */
export function ProductFilters({
  categories,
  current,
}: {
  categories: CategoryNode[];
  current: ProductFilter;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(false);

  // Rupees for display; the URL and API carry paisa.
  const [minPrice, setMinPrice] = React.useState(
    current.minPrice ? String(current.minPrice / 100) : '',
  );
  const [maxPrice, setMaxPrice] = React.useState(
    current.maxPrice ? String(current.maxPrice / 100) : '',
  );

  const pushWith = React.useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      // Any filter change resets pagination; keeping a stale cursor would show
      // page 3 of a result set the shopper has never seen page 1 of.
      params.delete('cursor');
      router.push(params.size > 0 ? `/products?${params}` : '/products', { scroll: false });
    },
    [router, searchParams],
  );

  // Debounce the price fields so each keystroke does not navigate.
  React.useEffect(() => {
    const currentMin = current.minPrice ? String(current.minPrice / 100) : '';
    const currentMax = current.maxPrice ? String(current.maxPrice / 100) : '';
    if (minPrice === currentMin && maxPrice === currentMax) return;

    const timer = setTimeout(() => {
      pushWith((params) => {
        if (minPrice) params.set('minPrice', String(Math.round(Number(minPrice) * 100)));
        else params.delete('minPrice');
        if (maxPrice) params.set('maxPrice', String(Math.round(Number(maxPrice) * 100)));
        else params.delete('maxPrice');
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [minPrice, maxPrice, current.minPrice, current.maxPrice, pushWith]);

  const activeCount = [current.category, current.minPrice, current.maxPrice, current.fabric].filter(
    Boolean,
  ).length;

  const flatCategories = React.useMemo(() => {
    const out: { slug: string; name: string; depth: number }[] = [];
    const walk = (nodes: CategoryNode[], depth: number) => {
      for (const node of nodes) {
        out.push({ slug: node.slug, name: node.name, depth });
        walk(node.children, depth + 1);
      }
    };
    walk(categories, 0);
    return out;
  }, [categories]);

  return (
    <>
      {/* Mobile toggle */}
      <div className="lg:hidden">
        <Button
          variant="outline"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="product-filters"
          fullWidth
        >
          <SlidersHorizontal aria-hidden="true" />
          Filters
          {activeCount > 0 && ` (${activeCount})`}
        </Button>
      </div>

      <aside
        id="product-filters"
        aria-label="Product filters"
        className={cn('space-y-6', !open && 'hidden lg:block')}
      >
        {/* Sort */}
        {/* SelectField rather than FormField — see the note in select-field.tsx. */}
        <SelectField
          label="Sort by"
          id="filter-sort"
          value={current.sort}
          onValueChange={(value) => pushWith((p) => p.set('sort', value))}
          options={[
            { value: 'newest', label: 'Newest first' },
            { value: 'popular', label: 'Most popular' },
            { value: 'rating', label: 'Best rated' },
            { value: 'price-asc', label: 'Price: low to high' },
            { value: 'price-desc', label: 'Price: high to low' },
          ]}
        />

        {/* Categories */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Category</legend>
          <ul className="space-y-0.5">
            <li>
              <button
                type="button"
                onClick={() => pushWith((p) => p.delete('category'))}
                aria-current={!current.category}
                className={cn(
                  'w-full rounded px-2 py-1.5 text-start text-sm hover:bg-accent',
                  !current.category && 'font-semibold text-primary',
                )}
              >
                All
              </button>
            </li>
            {flatCategories.map((category) => (
              <li key={category.slug}>
                <button
                  type="button"
                  onClick={() => pushWith((p) => p.set('category', category.slug))}
                  aria-current={current.category === category.slug}
                  style={{ paddingInlineStart: `${0.5 + category.depth * 0.75}rem` }}
                  className={cn(
                    'w-full rounded py-1.5 pe-2 text-start text-sm hover:bg-accent',
                    current.category === category.slug && 'font-semibold text-primary',
                  )}
                >
                  {category.name}
                </button>
              </li>
            ))}
          </ul>
        </fieldset>

        {/* Price */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Price (Rs)</legend>
          <div className="flex items-center gap-2">
            <FormField label="Minimum price" id="filter-min-price" hideLabel className="flex-1">
              <Input
                type="text"
                inputMode="numeric"
                placeholder="Min"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value.replace(/\D/g, ''))}
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
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value.replace(/\D/g, ''))}
              />
            </FormField>
          </div>
        </fieldset>

        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            onClick={() => {
              setMinPrice('');
              setMaxPrice('');
              router.push('/products', { scroll: false });
            }}
          >
            <X aria-hidden="true" />
            Clear all filters
          </Button>
        )}
      </aside>
    </>
  );
}
