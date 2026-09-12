import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { CheckoutContext } from '@momishop/shared/api-types';
import { CheckoutForm } from '@/components/checkout/checkout-form';
import { apiGet } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

/**
 * Checkout.
 *
 * An empty bag goes back to the cart page rather than rendering a checkout
 * with nothing to buy, and so does a bag with lines that can no longer be
 * fulfilled — the cart page is built to explain that problem.
 */
export default async function CheckoutPage() {
  const context = await apiGet<CheckoutContext>('/checkout/context');

  if (context.status !== 'READY') {
    redirect(context.status === 'SIGN_IN_REQUIRED' ? '/login?callbackUrl=/checkout' : '/cart');
  }

  return (
    <div className="container py-8">
      <h1 className="text-display font-semibold">Checkout</h1>

      <CheckoutForm
        lines={context.lines}
        currency={context.currency}
        savedAddresses={context.savedAddresses}
        loyaltyBalance={context.loyaltyBalance}
        loyaltyEnabled={context.loyaltyEnabled}
        user={context.user}
        appliedCouponCode={context.appliedCouponCode}
        maxStitchingDays={context.maxStitchingDays}
      />
    </div>
  );
}
