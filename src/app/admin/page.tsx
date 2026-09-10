import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Package, ShoppingCart, TrendingUp, Users } from 'lucide-react';
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { requirePermission } from '@/server/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatMoney } from '@/lib/money';
import { formatDate, relativeTime } from '@/lib/utils';
import { STATUS_PRESENTATION } from '@/lib/order-status';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * Admin dashboard.
 *
 * Answers the three questions an owner opens the admin to ask: what came in,
 * what needs doing today, and what is about to run out. Deliberately not a
 * wall of charts — a metric nobody acts on is noise.
 *
 * Revenue excludes cancelled and refunded orders, matching countsAsRevenue()
 * in the order state machine, so the number here reconciles with the reports
 * page rather than being a second, subtly different definition.
 */
export default async function AdminDashboardPage() {
  await requirePermission('order.read');

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  /**
   * Revenue excludes cancelled and refunded orders, matching
   * countsAsRevenue() in the order state machine — so this figure reconciles
   * with the reports page instead of being a second, subtly different
   * definition of "revenue".
   */
  const revenueWhere: Prisma.OrderWhereInput = {
    status: { notIn: ['CANCELLED', 'REFUNDED'] },
  };

  const [
    todayRevenue,
    monthRevenue,
    lastMonthRevenue,
    todayOrders,
    needsAction,
    customerCount,
    recentOrders,
    lowStock,
    pendingReviews,
  ] = await Promise.all([
    prisma.order.aggregate({
      where: { ...revenueWhere, placedAt: { gte: startOfToday } },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: { ...revenueWhere, placedAt: { gte: startOfMonth } },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: {
        ...revenueWhere,
        placedAt: { gte: startOfLastMonth, lt: startOfMonth },
      },
      _sum: { grandTotal: true },
    }),
    prisma.order.count({ where: { placedAt: { gte: startOfToday } } }),
    prisma.order.count({ where: { status: { in: ['PENDING', 'CONFIRMED'] } } }),
    prisma.user.count({ where: { role: 'CUSTOMER', deletedAt: null } }),
    prisma.order.findMany({
      orderBy: { placedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        orderNumber: true,
        email: true,
        status: true,
        grandTotal: true,
        currency: true,
        placedAt: true,
        paymentMethod: true,
      },
    }),
    prisma.productVariant.findMany({
      where: {
        trackInventory: true,
        isActive: true,
        // Prisma cannot compare two columns directly, so the alert threshold
        // is applied in memory after fetching a bounded candidate set.
        stockOnHand: { lte: 10 },
        product: { status: 'ACTIVE', archivedAt: null },
      },
      orderBy: { stockOnHand: 'asc' },
      take: 40,
      select: {
        id: true,
        name: true,
        sku: true,
        stockOnHand: true,
        lowStockAlert: true,
        product: { select: { name: true, slug: true } },
      },
    }),
    prisma.review.count({ where: { status: 'PENDING' } }),
  ]);

  const trulyLowStock = lowStock
    .filter((variant) => variant.stockOnHand <= variant.lowStockAlert)
    .slice(0, 8);

  const monthTotal = monthRevenue._sum.grandTotal ?? 0;
  const lastMonthTotal = lastMonthRevenue._sum.grandTotal ?? 0;
  const monthChange =
    lastMonthTotal > 0 ? Math.round(((monthTotal - lastMonthTotal) / lastMonthTotal) * 100) : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatDate(now)}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={TrendingUp}
          label="Revenue today"
          value={formatMoney(todayRevenue._sum.grandTotal ?? 0)}
          hint={`${todayOrders} order${todayOrders === 1 ? '' : 's'}`}
        />
        <MetricCard
          icon={TrendingUp}
          label="Revenue this month"
          value={formatMoney(monthTotal)}
          hint={
            monthChange === null
              ? `${monthRevenue._count._all} orders`
              : `${monthChange >= 0 ? '+' : ''}${monthChange}% vs last month`
          }
          tone={monthChange !== null && monthChange < 0 ? 'warning' : 'default'}
        />
        <MetricCard
          icon={ShoppingCart}
          label="Needs action"
          value={String(needsAction)}
          hint="Orders awaiting production"
          href="/admin/orders?status=PENDING"
        />
        <MetricCard
          icon={Users}
          label="Customers"
          value={String(customerCount)}
          hint="Registered accounts"
        />
      </div>

      {pendingReviews > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
          <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden="true" />
          <p className="flex-1 text-sm">
            {pendingReviews} review{pendingReviews === 1 ? '' : 's'} waiting for moderation.
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
            {recentOrders.length === 0 ? (
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
                    {recentOrders.map((order) => (
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
            {trulyLowStock.length === 0 ? (
              <EmptyState
                icon={Package}
                title="Stock levels are healthy"
                description="Nothing is below its low-stock threshold."
                className="border-0 py-8"
              />
            ) : (
              <ul className="divide-y">
                {trulyLowStock.map((variant) => (
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
