import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Package, ShoppingCart, TrendingUp, Users } from 'lucide-react';
import type { AdminDashboard } from '@momishop/shared/api-types';
import { formatMoney } from '@momishop/shared/money';
import { STATUS_PRESENTATION } from '@momishop/shared/order-status';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { apiGet } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * Admin dashboard.
 *
 * Answers the three questions an owner opens the admin to ask: what came in,
 * what needs doing today, and what is about to run out. Deliberately not a
 * wall of charts — a metric nobody acts on is noise.
 *
 * The figures are computed by the API, which requires the `order.read`
 * permission and excludes cancelled and refunded orders from revenue so the
 * number reconciles with the reports page.
 */
export default async function AdminDashboardPage() {
  const dashboard = await apiGet<AdminDashboard>('/admin/dashboard');
  const change = dashboard.monthOverMonthChange;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatDate(new Date())}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={TrendingUp}
          label="Revenue today"
          value={formatMoney(dashboard.revenueToday)}
          hint={`${dashboard.ordersToday} order${dashboard.ordersToday === 1 ? '' : 's'}`}
        />
        <MetricCard
          icon={TrendingUp}
          label="Revenue this month"
          value={formatMoney(dashboard.revenueThisMonth)}
          hint={
            change === null
              ? `${dashboard.ordersThisMonth} orders`
              : `${change >= 0 ? '+' : ''}${change}% vs last month`
          }
          tone={change !== null && change < 0 ? 'warning' : 'default'}
        />
        <MetricCard
          icon={ShoppingCart}
          label="Needs action"
          value={String(dashboard.needsAction)}
          hint="Orders awaiting production"
          href="/admin/orders?status=PENDING"
        />
        <MetricCard
          icon={Users}
          label="Customers"
          value={String(dashboard.customerCount)}
          hint="Registered accounts"
        />
      </div>

      {dashboard.pendingReviews > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
          <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden="true" />
          <p className="flex-1 text-sm">
            {dashboard.pendingReviews} review{dashboard.pendingReviews === 1 ? '' : 's'} waiting for
            moderation.
          </p>
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/reviews">Moderate</Link>
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent orders */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle as="h2">Recent orders</CardTitle>
            <Button variant="link" size="sm" asChild className="px-0">
              <Link href="/admin/orders">
                View all
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </CardHeader>

          <CardContent>
            {dashboard.recentOrders.length === 0 ? (
              <EmptyState
                icon={ShoppingCart}
                title="No orders yet"
                description="Orders will appear here as they come in."
                className="border-0 py-8"
              />
            ) : (
              <div className="scroll-x">
                <table className="w-full text-sm">
                  <caption className="sr-only">The eight most recent orders</caption>
                  <thead>
                    <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                      <th scope="col" className="pb-2 text-start font-medium">
                        Order
                      </th>
                      <th scope="col" className="pb-2 text-start font-medium">
                        Status
                      </th>
                      <th scope="col" className="pb-2 text-end font-medium">
                        Total
                      </th>
                      <th scope="col" className="pb-2 text-end font-medium">
                        Placed
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {dashboard.recentOrders.map((order) => (
                      <tr key={order.id}>
                        <td className="py-2.5">
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {order.orderNumber}
                          </Link>
                          <span className="block truncate text-xs text-muted-foreground">
                            {order.email}
                          </span>
                        </td>
                        <td className="py-2.5">
                          <Badge variant={toneToBadge(STATUS_PRESENTATION[order.status].tone)}>
                            {STATUS_PRESENTATION[order.status].label}
                          </Badge>
                        </td>
                        <td className="py-2.5 text-end tabular-nums">
                          {formatMoney(order.grandTotal)}
                        </td>
                        <td className="py-2.5 text-end text-xs text-muted-foreground">
                          {relativeTime(order.placedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Low stock */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle as="h2">Running low</CardTitle>
            <Button variant="link" size="sm" asChild className="px-0">
              <Link href="/admin/products">
                Manage stock
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </CardHeader>

          <CardContent>
            {dashboard.lowStock.length === 0 ? (
              <EmptyState
                icon={Package}
                title="Stock levels are healthy"
                description="Nothing is below its low-stock threshold."
                className="border-0 py-8"
              />
            ) : (
              <ul className="divide-y">
                {dashboard.lowStock.map((variant) => (
                  <li key={variant.id} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{variant.product.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {variant.name} · {variant.sku}
                      </p>
                    </div>
                    <Badge variant={variant.stockOnHand === 0 ? 'destructive' : 'warning'}>
                      {variant.stockOnHand} left
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  href,
  tone = 'default',
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  hint: string;
  href?: string;
  tone?: 'default' | 'warning';
}) {
  const body = (
    <Card className="h-full transition-colors hover:bg-accent/40">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="mt-2 font-serif text-2xl font-semibold tabular-nums">{value}</p>
        <p
          className={
            tone === 'warning' ? 'mt-1 text-xs text-warning' : 'mt-1 text-xs text-muted-foreground'
          }
        >
          {hint}
        </p>
      </CardContent>
    </Card>
  );

  return href ? (
    <Link
      href={href}
      className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

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
