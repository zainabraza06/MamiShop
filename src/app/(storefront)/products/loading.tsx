import { ProductGridSkeleton } from '@/components/ui/skeleton';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Streaming fallback for the product listing.
 *
 * Next renders this as the Suspense boundary while the page's data resolves.
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
