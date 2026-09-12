import type { Metadata } from 'next';
import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import type { AdminOrderList } from '@momishop/shared/api-types';
import { formatMoney, type Currency } from '@momishop/shared/money';
import { STATUS_PRESENTATION, type OrderStatus } from '@momishop/shared/order-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { apiGet } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Orders' };

/**
 * The order queue.
 *
 * Filters live in the URL rather than in component state, so a view can be
 * bookmarked, shared with a colleague, or reloaded without losing its place —
 * and the dashboard's "needs action" card links straight into one.
 */

const TABS: { label: string; status?: OrderStatus }[] = [
  { label: 'All' },
  { label: 'Pending', status: 'PENDING' },
  { label: 'Confirmed', status: 'CONFIRMED' },
  { label: 'Being stitched', status: 'IN_PRODUCTION' },
  { label: 'Ready to ship', status: 'READY_TO_SHIP' },
  { label: 'Shipped', status: 'SHIPPED' },
  { label: 'Delivered', status: 'DELIVERED' },
];

function toneToBadge(tone: 'neutral' | 'progress' | 'success' | 'danger') {
  switch (tone) {
    case 'success':
      return 'success' as const;
    case 'danger':
      return 'destructive' as const;
    case 'progress':
      return 'default' as const;
    default:
      return 'secondary' as const;
  }
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = typeof params.status === 'string' ? params.status : undefined;
  const q = typeof params.q === 'string' ? params.q : undefined;

  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (q) query.set('q', q);

  const { items, total, countsByStatus } = await apiGet<AdminOrderList>(
    `/admin/orders?${query.toString()}`,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} order{total === 1 ? '' : 's'}
            {status ? ` with status ${STATUS_PRESENTATION[status as OrderStatus].label}` : ''}
          </p>
        </div>

        <form className="flex gap-2" action="/admin/orders">
          <Input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Order number or email"
            aria-label="Search orders"
            className="w-56"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const active = tab.status === status || (!tab.status && !status);
            const count = tab.status ? (countsByStatus[tab.status] ?? 0) : total;
            const href = tab.status ? `/admin/orders?status=${tab.status}` : '/admin/orders';

            return (
              <li key={tab.label}>
                <Button variant={active ? 'default' : 'outline'} size="sm" asChild>
                  <Link href={href} aria-current={active ? 'page' : undefined}>
                    {tab.label}
                    <span className="ms-1.5 tabular-nums opacity-70">{count}</span>
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </nav>

      {items.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="Nothing here"
          description={
            q || status
              ? 'No orders match that filter.'
              : 'Orders will appear here as customers place them.'
          }
          action={
            q || status ? (
              <Button variant="outline" asChild>
                <Link href="/admin/orders">Clear filters</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="scroll-x rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">Orders, newest first</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-start text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="p-3 text-start font-medium">
                  Order
                </th>
                <th scope="col" className="p-3 text-start font-medium">
                  Status
                </th>
                <th scope="col" className="p-3 text-start font-medium">
                  Payment
                </th>
                <th scope="col" className="p-3 text-end font-medium">
                  Total
                </th>
                <th scope="col" className="p-3 text-end font-medium">
                  Placed
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((order) => (
                <tr key={order.id} className="hover:bg-accent/30">
                  <td className="p-3">
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {order.email} · {order.itemCount} item{order.itemCount === 1 ? '' : 's'}
                      {order.isManual ? ' · phone order' : ''}
                    </span>
                  </td>
                  <td className="p-3">
                    <Badge variant={toneToBadge(STATUS_PRESENTATION[order.status].tone)}>
                      {STATUS_PRESENTATION[order.status].label}
                    </Badge>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {order.paymentStatus.replace('_', ' ').toLowerCase()}
                    {order.refundedTotal > 0 && (
                      <span className="block">
                        refunded {formatMoney(order.refundedTotal, order.currency as Currency)}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-end tabular-nums">
                    {formatMoney(order.grandTotal, order.currency as Currency)}
                  </td>
                  <td className="p-3 text-end text-xs text-muted-foreground">
                    <span title={formatDate(order.placedAt)}>{relativeTime(order.placedAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
