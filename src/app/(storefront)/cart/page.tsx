import type { Metadata } from 'next';
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { getCart, validateCartLines } from '@/server/cart';
import { CartView } from '@/components/cart/cart-view';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { serializable } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Your bag',
  // The cart is inherently per-visitor; keeping it out of the index also keeps
  // it out of any shared cache.
  robots: { index: false, follow: false },
};

/**
 * Cart page.
 *
 * Always dynamic — it reads the cart cookie. Line availability is re-checked
 * on every view so a basket left open for days surfaces its problems here
 * rather than failing at the payment step, which is where an abandoned
 * checkout usually comes from.
 */
export default async function CartPage() {
  const cart = await getCart();

  if (!cart || cart.items.length === 0) {
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

  const issues = validateCartLines(cart);

  const lines = cart.items.map((item) => ({
    id: item.id,
    quantity: item.quantity,
    productName: item.product.name,
    productSlug: item.product.slug,
    variantName: item.variant?.name ?? null,
    unitPrice: item.product.basePrice + (item.variant?.priceDelta ?? 0),
    currency: item.product.currency,
    imageUrl: item.product.images[0]?.url ?? null,
    imageAlt: item.product.images[0]?.alt ?? item.product.name,
    stitchingDays: item.product.stitchingDays,
    measurementUnit: item.measurementUnit,
    measurementValues: item.measurementValues as Record<string, number> | null,
    // Same product -> category -> default chain the product page used; most
    // products inherit their template rather than setting one.
    measurementTemplate:
      item.product.sizingTemplate ?? item.product.category.sizingTemplate ?? 'WOMENS_STITCHED',
    customNote: item.customNote,
    issue: issues.find((i) => i.itemId === item.id) ?? null,
  }));

  return (
    <div className="container py-8">
      <h1 className="text-display font-semibold">Your bag</h1>
      <CartView lines={serializable(lines)} couponCode={cart.coupon?.code ?? null} />
    </div>
  );
}
