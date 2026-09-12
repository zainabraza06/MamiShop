import type { Metadata } from 'next';
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import type { CartContents } from '@momishop/shared/api-types';
import { CartView } from '@/components/cart/cart-view';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Your bag',
  // The cart is inherently per-visitor; keeping it out of the index also keeps
  // it out of any shared cache.
  robots: { index: false, follow: false },
};

/**
 * Cart page.
 *
 * Always dynamic — it reads the visitor's bag. The API re-checks line
 * availability on every read, so a basket left open for days surfaces its
 * problems here rather than failing at the payment step, which is where an
 * abandoned checkout usually comes from.
 */
export default async function CartPage() {
  const { lines, couponCode } = await apiGet<CartContents>('/cart');

  if (lines.length === 0) {
    return (
      <div className="container py-16">
        <h1 className="sr-only">Your bag</h1>
        <EmptyState
          icon={ShoppingBag}
          title="Your bag is empty"
          description="Once you add a piece and give us your measurements, it will appear here."
          action={
            <Button asChild size="lg">
              <Link href="/products">Start shopping</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="container py-8">
      <h1 className="text-display font-semibold">Your bag</h1>
      <CartView lines={lines} couponCode={couponCode} />
    </div>
  );
}
