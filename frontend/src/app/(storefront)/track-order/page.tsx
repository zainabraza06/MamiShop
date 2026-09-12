import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TrackOrderForm } from '@/components/orders/track-order-form';

export const metadata: Metadata = {
  title: 'Track your order',
  description: 'See where your MomiShop order has got to, using your order number and email.',
  alternates: { canonical: '/track-order' },
};

export default function TrackOrderPage() {
  return (
    <div className="container max-w-2xl py-12">
      <h1 className="text-display font-semibold">Track your order</h1>
      <p className="mt-3 text-muted-foreground">
        Made-to-measure pieces are cut and stitched after your order is confirmed, so the workshop
        stages below take longer than an off-the-shelf delivery.
      </p>

      {/* useSearchParams reads ?order= from the confirmation page's link. */}
      <Suspense fallback={null}>
        <TrackOrderForm />
      </Suspense>
    </div>
  );
}
