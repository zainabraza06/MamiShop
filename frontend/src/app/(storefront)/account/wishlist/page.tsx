import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Heart } from 'lucide-react';
import type { ProductCard as ProductCardData } from '@momishop/shared/api-types';
import { ProductCard } from '@/components/product/product-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ApiError, apiGet } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Saved pieces',
  robots: { index: false, follow: false },
};

export default async function WishlistPage() {
  let items: ProductCardData[];
  try {
    ({ items } = await apiGet<{ items: ProductCardData[] }>('/wishlist'));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect('/login?callbackUrl=/account/wishlist');
    }
    throw error;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Heart}
        title="Nothing saved yet"
        description="Tap the heart on a piece you like and it will wait for you here."
        action={
          <Button asChild>
            <Link href="/products">Browse the collection</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <h2 className="sr-only">Saved pieces</h2>
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-3">
        {items.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}
