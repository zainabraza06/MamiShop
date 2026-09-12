import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Heart, Package, Ruler } from 'lucide-react';
import type { AccountOverview } from '@momishop/shared/api-types';
import { formatMoney, type Currency } from '@momishop/shared/money';
import { STATUS_PRESENTATION } from '@momishop/shared/order-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ApiError, apiGet } from '@/lib/api';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  let overview: AccountOverview;
  try {
    overview = await apiGet<AccountOverview>('/account/overview');
  } catch (error) {
    // The session expired between the proxy's check and this request.
    if (error instanceof ApiError && error.status === 401) redirect('/login?callbackUrl=/account');
    throw error;
  }

  const summary = [
    { icon: Package, label: 'Orders', value: String(overview.orders.length), href: undefined },
    {
      icon: Heart,
      label: 'Saved pieces',
      value: String(overview.wishlistCount),
      href: '/account/wishlist',
    },
    {
      icon: Ruler,
      label: 'Measurement profiles',
      value: String(overview.measurementProfileCount),
      href: undefined,
    },
  ];

  return (
    <div className="space-y-8">
      <p className="text-muted-foreground">
        Signed in as <strong className="text-foreground">{overview.user.email}</strong>
      </p>

      <ul className="grid gap-4 sm:grid-cols-3">
        {summary.map(({ icon: Icon, label, value, href }) => {
          const card = (
            <div className="rounded-lg border p-5">
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              <p className="mt-2 font-serif text-2xl font-semibold tabular-nums">{value}</p>
              <p className="text-sm text-muted-foreground">{label}</p>
            </div>
          );
          return <li key={label}>{href ? <Link href={href}>{card}</Link> : card}</li>;
        })}
      </ul>

      <section aria-labelledby="recent-orders">
        <h2 id="recent-orders" className="font-serif text-lg font-semibold">
          Recent orders
        </h2>

        {overview.orders.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No orders yet"
            description="When you order, it will appear here with its progress through the workshop."
            action={
              <Button asChild>
                <Link href="/products">Browse the collection</Link>
              </Button>
            }
            className="mt-4"
          />
        ) : (
          <ul className="mt-4 divide-y rounded-lg border">
            {overview.orders.map((order) => (
              <li key={order.orderNumber} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm">{order.orderNumber}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(order.placedAt)}</p>
                </div>
                <Badge variant="secondary">{STATUS_PRESENTATION[order.status].label}</Badge>
                <p className="text-sm tabular-nums">
                  {formatMoney(order.grandTotal, order.currency as Currency)}
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/track-order?order=${order.orderNumber}`}>Track</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
