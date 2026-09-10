'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ProductCard } from '@/components/product/product-card';
import type { ProductCard as ProductCardData } from '@/server/catalogue';
import type { ProductFilter } from '@/lib/validation';

/**
 * Cursor-based "load more".
 *
 * A button rather than an infinite scroll: infinite scroll makes the footer
 * unreachable, breaks the back button, and is hostile to keyboard and screen
 * reader users who cannot trigger the scroll observer.
 *
 * Newly loaded items are announced through a live region so the addition is
 * not silent for assistive technology.
 */
export function LoadMore({
  initialCursor,
  filter,
  initialCount,
}: {
  initialCursor: string;
  filter: ProductFilter;
  initialCount: number;
}) {
  const [items, setItems] = React.useState<ProductCardData[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(initialCursor);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function loadMore() {
    if (!cursor || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (filter.category) params.set('category', filter.category);
      if (filter.q) params.set('q', filter.q);
      if (filter.minPrice !== undefined) params.set('minPrice', String(filter.minPrice));
      if (filter.maxPrice !== undefined) params.set('maxPrice', String(filter.maxPrice));
      params.set('sort', filter.sort);
      params.set('cursor', cursor);

      const response = await fetch(`/api/products?${params}`);
      if (!response.ok) throw new Error('Could not load more products');

      const body = (await response.json()) as {
        items: ProductCardData[];
        nextCursor: string | null;
      };

      setItems((current) => [...current, ...body.items]);
      setCursor(body.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more products');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      {items.length > 0 && (
        <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 xl:grid-cols-4">
          {items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {items.length > 0 ? `Showing ${initialCount + items.length} products` : ''}
      </p>

      {error && (
        <p role="alert" className="mt-6 text-center text-sm text-destructive">
          {error}
        </p>
      )}

      {cursor && (
        <div className="mt-10 text-center">
          <Button variant="outline" size="lg" onClick={loadMore} isLoading={isLoading}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}
