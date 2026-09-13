import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db';

/** Counts for the admin sidebar badges: what actually needs a human today. */
export async function getAdminBadges() {
  const [orders, returns, reviews, requests] = await Promise.all([
    prisma.order.count({ where: { status: { in: ['PENDING', 'CONFIRMED'] } } }),
    prisma.returnRequest.count({ where: { status: 'REQUESTED' } }),
    prisma.review.count({ where: { status: 'PENDING' } }),
    // Conversations where the customer spoke last and nobody has looked since.
    prisma.customRequest.count({
      where: { unreadByStaff: true, status: { notIn: ['CLOSED', 'DECLINED'] } },
    }),
  ]);

  return { orders, returns, reviews, requests };
}

/**
 * The admin dashboard.
 *
 * Answers the three questions an owner opens the admin to ask: what came in,
 * what needs doing today, and what is about to run out. Deliberately not a
 * wall of charts — a metric nobody acts on is noise.
 *
 * Revenue excludes cancelled and refunded orders, matching countsAsRevenue()
 * in the order state machine, so this figure reconciles with the reports page
 * instead of being a second, subtly different definition of "revenue".
 */
export async function getDashboardSummary(now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const revenueWhere: Prisma.OrderWhereInput = {
    status: { notIn: ['CANCELLED', 'REFUNDED'] },
  };

  const [
    todayRevenue,
    monthRevenue,
    lastMonthRevenue,
    ordersToday,
    needsAction,
    customerCount,
    recentOrders,
    lowStockCandidates,
    pendingReviews,
  ] = await Promise.all([
    prisma.order.aggregate({
      where: { ...revenueWhere, placedAt: { gte: startOfToday } },
      _sum: { grandTotal: true },
    }),
    prisma.order.aggregate({
      where: { ...revenueWhere, placedAt: { gte: startOfMonth } },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: { ...revenueWhere, placedAt: { gte: startOfLastMonth, lt: startOfMonth } },
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
        // Prisma cannot compare two columns directly, so the per-variant alert
        // threshold is applied in memory after fetching a bounded candidate set.
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

  const revenueThisMonth = monthRevenue._sum.grandTotal ?? 0;
  const revenueLastMonth = lastMonthRevenue._sum.grandTotal ?? 0;

  return {
    revenueToday: todayRevenue._sum.grandTotal ?? 0,
    ordersToday,
    revenueThisMonth,
    ordersThisMonth: monthRevenue._count._all,
    /** Whole-number percentage change, or null when last month had no revenue to compare. */
    monthOverMonthChange:
      revenueLastMonth > 0
        ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100)
        : null,
    needsAction,
    customerCount,
    pendingReviews,
    recentOrders,
    lowStock: lowStockCandidates
      .filter((variant) => variant.stockOnHand <= variant.lowStockAlert)
      .slice(0, 8),
  };
}
