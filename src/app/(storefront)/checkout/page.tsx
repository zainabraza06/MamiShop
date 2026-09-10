import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCart, validateCartLines } from '@/server/cart';
import { getCurrentUser } from '@/server/session';
import { prisma } from '@/lib/db';
import { CheckoutForm } from '@/components/checkout/checkout-form';
import { serializable } from '@/lib/utils';
import { flags } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

/**
 * Checkout.
 *
 * Redirects an empty cart back to the bag rather than rendering a checkout
 * with nothing to buy. A cart with unfulfillable lines goes back too — better
 * to fix it on the cart page, which is built to explain the problem.
 */
export default async function CheckoutPage() {
  const cart = await getCart();

  if (!cart || cart.items.length === 0) redirect('/cart');

  const blocking = validateCartLines(cart).filter((issue) => issue.reason !== 'QUANTITY_REDUCED');
  if (blocking.length > 0) redirect('/cart');

  const user = await getCurrentUser();

  if (!user && !flags.guestCheckout) {
    redirect('/login?callbackUrl=/checkout');
  }

  const [addresses, loyalty] = await Promise.all([
    user
      ? prisma.address.findMany({
          where: { userId: user.id, deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        })
      : Promise.resolve([]),
    user
      ? prisma.loyaltyAccount.findUnique({
          where: { userId: user.id },
          select: { balance: true },
        })
      : Promise.resolve(null),
  ]);

  const lines = cart.items.map((item) => ({
    id: item.id,
    quantity: item.quantity,
    productName: item.product.name,
    variantName: item.variant?.name ?? null,
    unitPrice: item.product.basePrice + (item.variant?.priceDelta ?? 0),
    imageUrl: item.product.images[0]?.url ?? null,
    imageAlt: item.product.images[0]?.alt ?? item.product.name,
  }));

  const maxStitchingDays = Math.max(...cart.items.map((i) => i.product.stitchingDays));

  return (
    <div className="container py-8">
      <h1 className="text-display font-semibold">Checkout</h1>

      <CheckoutForm
        lines={serializable(lines)}
        currency={cart.currency}
        savedAddresses={serializable(addresses)}
        loyaltyBalance={loyalty?.balance ?? 0}
        loyaltyEnabled={flags.loyalty}
        user={user ? { email: user.email, name: user.name, id: user.id } : null}
        appliedCouponCode={cart.coupon?.code ?? null}
        maxStitchingDays={maxStitchingDays}
      />
    </div>
  );
}
