import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { AdminCategory } from '@momishop/shared/api-types';
import { ProductForm } from '@/components/admin/product-form';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = { title: 'New product' };

export default async function NewProductPage() {
  const { categories } = await apiGet<{ categories: AdminCategory[] }>('/admin/categories');

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Products
        </Link>
        <h1 className="mt-2 font-serif text-2xl font-semibold">New product</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          It starts as a draft — nothing shows on the storefront until you set it live.
        </p>
      </div>

      <ProductForm product={null} categories={categories} />
    </div>
  );
}
