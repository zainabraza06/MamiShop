import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import type {
  AdminCategory,
  AdminProductDetail,
  AdminStorefrontFilter,
} from '@momishop/shared/api-types';
import { formatDateTime } from '@momishop/shared/text';
import { ArchiveProduct } from '@/components/admin/product-actions';
import { ProductForm } from '@/components/admin/product-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiGet, ApiError } from '@/lib/api';

export const metadata: Metadata = { title: 'Edit product' };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [detail, categoryList, filterList] = await Promise.all([
    apiGet<{ product: AdminProductDetail }>(`/admin/products/${id}`).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
    apiGet<{ categories: AdminCategory[] }>('/admin/categories'),
    // Optional to editing: if filters cannot be loaded (an API a release
    // behind), the form still works, just without the Shop filters section.
    apiGet<{ filters: AdminStorefrontFilter[] }>('/admin/filters').catch(() => ({
      filters: [] as AdminStorefrontFilter[],
    })),
  ]);

  if (!detail) notFound();
  const product = detail.product;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/products"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Products
          </Link>
          <h1 className="mt-2 flex flex-wrap items-center gap-2 font-serif text-2xl font-semibold">
            {product.name}
            <Badge variant={product.status === 'ACTIVE' ? 'default' : 'secondary'}>
              {product.status.toLowerCase()}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {product.sku}
            {product.archivedAt && ` · archived ${formatDateTime(product.archivedAt)}`}
          </p>
        </div>

        <div className="flex gap-2">
          {product.status === 'ACTIVE' && (
            <Button variant="outline" asChild>
              <Link href={`/products/${product.slug}`} target="_blank" rel="noreferrer">
                View in shop
                <ExternalLink aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
              </Link>
            </Button>
          )}
          {!product.archivedAt && <ArchiveProduct productId={product.id} name={product.name} />}
        </div>
      </div>

      <ProductForm
        product={product}
        categories={categoryList.categories}
        filters={filterList.filters}
      />
    </div>
  );
}
