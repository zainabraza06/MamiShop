import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { PackageSearch } from 'lucide-react';
import type { CategoryDetail, CategoryNode, ProductListResponse } from '@momishop/shared/api-types';
import { productFilterSchema, type ProductFilter } from '@momishop/shared/validation';
import { ProductCard } from '@/components/product/product-card';
import { ProductFilters } from '@/components/product/product-filters';
import { LoadMore } from '@/components/product/load-more';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { apiGet, apiGetOrNull } from '@/lib/api';

/**
 * Product listing.
 *
 * Rendered per request rather than statically because the filter combinations
 * are effectively unbounded — prerendering every category/price/sort/tag
 * permutation would be a combinatorial explosion for no benefit. The API's
 * queries are indexed and cursor-paginated, and it caches the category tree,
 * so a request is cheap.
 */

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The parsed filter, back as a query string for the API. */
function toQuery(filter: ProductFilter): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) for (const entry of value) params.append(key, String(entry));
    else params.set(key, String(value));
  }

  return params.toString();
}

/** Shared by the page and its metadata; deduplicated into one API call. */
function getCategory(slug: string) {
  return apiGetOrNull<{ category: CategoryDetail }>(`/categories/${encodeURIComponent(slug)}`);
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const categorySlug = typeof params.category === 'string' ? params.category : undefined;

  if (categorySlug) {
    const result = await getCategory(categorySlug);
    if (result) {
      const { category } = result;
      return {
        title: category.metaTitle ?? category.name,
        description:
          category.metaDescription ??
          `Shop ${category.name.toLowerCase()} stitched to your own measurements.`,
        alternates: { canonical: `/products?category=${category.slug}` },
      };
    }
  }

  const query = typeof params.q === 'string' ? params.q : undefined;

  return {
    title: query ? `Search: ${query}` : 'All products',
    description: 'Every piece stitched to your own measurements.',
    // Search result pages are noindex: they produce near-infinite thin
    // permutations that dilute the crawl budget for real category pages.
    robots: query ? { index: false, follow: true } : undefined,
    alternates: { canonical: '/products' },
  };
}

export default async function ProductsPage({ searchParams }: PageProps) {
  const raw = await searchParams;

  // An unparseable filter (someone editing the URL) falls back to defaults
  // rather than throwing a 500 at the shopper.
  const parsed = productFilterSchema.safeParse(raw);
  const filter = parsed.success ? parsed.data : productFilterSchema.parse({});

  const [{ items, nextCursor, total }, { categories }, categoryResult] = await Promise.all([
    apiGet<ProductListResponse>(`/products?${toQuery(filter)}`),
    apiGet<{ categories: CategoryNode[] }>('/categories'),
    filter.category ? getCategory(filter.category) : Promise.resolve(null),
  ]);

  const category = categoryResult?.category ?? null;
  const heading = category?.name ?? (filter.q ? `Results for “${filter.q}”` : 'All products');

  return (
    <div className="container py-6">
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          ...(category?.parent
            ? [
                {
                  label: category.parent.name,
                  href: `/products?category=${category.parent.slug}`,
                },
              ]
            : []),
          { label: heading },
        ]}
      />

      <div className="mt-6">
        <h1 className="text-display font-semibold">{heading}</h1>
        {category?.description && (
          <p className="mt-2 max-w-prose text-muted-foreground">{category.description}</p>
        )}
        <p aria-live="polite" className="mt-2 text-sm text-muted-foreground">
          {total} piece{total === 1 ? '' : 's'}
        </p>
      </div>

      {/* Subcategory shortcuts */}
      {category && category.children.length > 0 && (
        <nav aria-label="Subcategories" className="mt-6">
          <ul className="flex flex-wrap gap-2">
            {category.children.map((child) => (
              <li key={child.id}>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/products?category=${child.slug}`}>{child.name}</Link>
                </Button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
        <Suspense fallback={null}>
          <ProductFilters categories={categories} current={filter} />
        </Suspense>

        <div>
          {items.length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title="Nothing matches those filters"
              description="Try widening your price range, or browse everything we have."
              action={
                <Button asChild>
                  <Link href="/products">Clear filters</Link>
                </Button>
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 xl:grid-cols-4">
                {items.map((product, index) => (
                  <ProductCard key={product.id} product={product} priority={index < 4} />
                ))}
              </div>

              {nextCursor && (
                <LoadMore initialCursor={nextCursor} filter={filter} initialCount={items.length} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
