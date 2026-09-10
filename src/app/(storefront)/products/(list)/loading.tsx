import { ProductGridSkeleton } from '@/components/ui/skeleton';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Streaming fallback for the product LISTING only.
 *
 * It lives inside the `(list)` route group, not at `products/`, and that
 * placement is load-bearing rather than tidiness. A loading.tsx at the segment
 * root wraps the entire subtree — including `products/[slug]` — in one
 * Suspense boundary. The product page suspends on its database query, so Next
 * begins streaming and flushes 200 response headers before the page reaches
 * `notFound()`. Every dead product URL then answered 200 with 404 content: a
 * soft 404, which search engines index as a real page.
 *
 * A route group changes the boundary without changing the URL, so /products
 * still streams a skeleton and /products/[slug] can still return a true 404.
 *
 * The skeleton mirrors the real grid's proportions so the layout does not jump
 * when content arrives — a shifting grid is both jarring and a CLS penalty.
 */
export default function ProductsLoading() {
  return (
    <div className="container py-6">
      <Skeleton className="h-4 w-64" />
      <Skeleton className="mt-6 h-10 w-72" />
      <Skeleton className="mt-2 h-4 w-24" />

      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
        <div className="hidden space-y-4 lg:block">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <ProductGridSkeleton count={12} />
      </div>
    </div>
  );
}
