import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { hasPermission, type Principal, type UserRole } from '@momishop/shared/rbac';
import { prisma } from '../lib/db';
import { ValidationError } from '../lib/errors';
import { requirePermission } from '../auth/current-user';
import { ipHash } from '../http/request';
import { parseQuery } from '../http/validate';
import { actorFrom, recordAudit } from '../services/audit';

/**
 * Sales reports.
 *
 * Days are Pakistan days: an order placed at 1am in Lahore belongs to that
 * day, not to the previous one in UTC. Pakistan keeps no daylight saving, so a
 * day is always exactly 24 hours and the range arithmetic below is exact.
 *
 * "Revenue" means what the dashboard means by it: orders that were neither
 * cancelled nor refunded. Two screens that disagree about last month's sales
 * are worse than either one alone.
 */
export const adminReportsRouter = Router();

const SHOP_TIME_ZONE = 'Asia/Karachi';
const SHOP_UTC_OFFSET = '+05:00';
const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const MAX_EXPORT_ROWS = 10_000;

const NOT_REVENUE: Prisma.EnumOrderStatusFilter['notIn'] = ['CANCELLED', 'REFUNDED'];

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-01.');
const rangeSchema = z.object({ from: daySchema.optional(), to: daySchema.optional() });

/** The calendar day an instant falls on in Pakistan, as YYYY-MM-DD. */
function shopDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const startOfShopDay = (day: string) => new Date(`${day}T00:00:00${SHOP_UTC_OFFSET}`);

interface ReportRange {
  from: string;
  to: string;
  /** First instant of the first day. */
  start: Date;
  /** First instant after the last day. */
  end: Date;
  days: number;
}

/** The requested Pakistan days, defaulting to the last 30 including today. */
function resolveRange(input: { from?: string; to?: string }, now = new Date()): ReportRange {
  const to = input.to ?? shopDay(now);
  const lastDay = startOfShopDay(to);
  const from = input.from ?? shopDay(new Date(lastDay.getTime() - 29 * DAY_MS));
  const start = startOfShopDay(from);

  // "2026-02-30" matches the pattern but is not a day.
  if (Number.isNaN(start.getTime()) || Number.isNaN(lastDay.getTime())) {
    throw new ValidationError('Use real calendar dates.');
  }
  if (shopDay(start) !== from || shopDay(lastDay) !== to) {
    throw new ValidationError('Use real calendar dates.');
  }
  if (lastDay < start) {
    throw new ValidationError('The end date must come after the start date.', [
      { field: 'to', message: 'Before the start date.' },
    ]);
  }

  const days = Math.round((lastDay.getTime() - start.getTime()) / DAY_MS) + 1;
  if (days > MAX_DAYS) {
    throw new ValidationError(`Pick a range of a year or less; that one is ${days} days.`, [
      { field: 'from', message: 'Range too long.' },
    ]);
  }

  return { from, to, start, end: new Date(lastDay.getTime() + DAY_MS), days };
}

async function loadReport(range: ReportRange) {
  const inRange: Prisma.OrderWhereInput = { placedAt: { gte: range.start, lt: range.end } };
  const revenueWhere: Prisma.OrderWhereInput = { ...inRange, status: { notIn: NOT_REVENUE } };

  const [totals, refunds, cancelled, dailyRows, products, payments] = await Promise.all([
    prisma.order.aggregate({
      where: revenueWhere,
      _sum: { grandTotal: true, discountTotal: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({ where: inRange, _sum: { refundedTotal: true } }),
    prisma.order.count({ where: { ...inRange, status: 'CANCELLED' } }),
    // Grouping by Pakistan day needs the time zone conversion in SQL; Prisma's
    // groupBy can only group by stored columns.
    prisma.$queryRaw<{ day: string; orders: number; revenue: bigint | number }[]>`
      SELECT to_char(("placedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${SHOP_TIME_ZONE}, 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS orders,
             COALESCE(SUM("grandTotal"), 0)::bigint AS revenue
      FROM "orders"
      WHERE "placedAt" >= ${range.start}
        AND "placedAt" < ${range.end}
        AND "status"::text NOT IN ('CANCELLED', 'REFUNDED')
      GROUP BY 1
      ORDER BY 1`,
    prisma.orderItem.groupBy({
      by: ['productName'],
      where: { order: revenueWhere },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: 'desc' } },
      take: 10,
    }),
    prisma.order.groupBy({
      by: ['paymentMethod'],
      where: revenueWhere,
      _count: { _all: true },
      _sum: { grandTotal: true },
    }),
  ]);

  // Every day in the range appears, including days with no orders: a gap in
  // the chart should look like a quiet day, not like a day that is missing.
  const byDate = new Map(
    dailyRows.map((row) => [row.day, { orders: Number(row.orders), revenue: Number(row.revenue) }]),
  );
  const byDay = Array.from({ length: range.days }, (_, index) => {
    const day = shopDay(new Date(range.start.getTime() + index * DAY_MS));
    return { day, ...(byDate.get(day) ?? { orders: 0, revenue: 0 }) };
  });

  const revenue = totals._sum.grandTotal ?? 0;
  const orders = totals._count._all;

  return {
    summary: {
      revenue,
      orders,
      averageOrder: orders > 0 ? Math.round(revenue / orders) : 0,
      discounts: totals._sum.discountTotal ?? 0,
      refunded: refunds._sum.refundedTotal ?? 0,
      cancelled,
    },
    byDay,
    topProducts: products.map((row) => ({
      name: row.productName,
      quantity: row._sum.quantity ?? 0,
      revenue: row._sum.lineTotal ?? 0,
    })),
    byPayment: payments
      .map((row) => ({
        method: row.paymentMethod,
        orders: row._count._all,
        revenue: row._sum.grandTotal ?? 0,
      }))
      .sort((a, b) => b.revenue - a.revenue),
  };
}

adminReportsRouter.get('/admin/reports', async (req, res) => {
  const actor = await requirePermission(req, 'report.read');
  const principal: Principal = { role: actor.role as UserRole, permissions: actor.permissions };
  const range = resolveRange(parseQuery(req, rangeSchema));

  res.json({
    range: { from: range.from, to: range.to },
    ...(await loadReport(range)),
    canExport: hasPermission(principal, 'report.export'),
  });
});

/**
 * One spreadsheet cell.
 *
 * A cell beginning with = + - or @ runs as a formula when the file is opened
 * in Excel or Sheets, and a coupon code or product name is text anyone could
 * have typed. A leading apostrophe keeps it as plain text.
 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const rupees = (minor: number) => (minor / 100).toFixed(2);

function shopDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(', ', ' ');
}

/**
 * The orders in a range, for the accountant.
 *
 * Deliberately no customer names, emails, phone numbers or addresses: a sales
 * spreadsheet gets emailed around, and it does not need them to add up.
 */
adminReportsRouter.get('/admin/reports/orders.csv', async (req, res) => {
  const actor = await requirePermission(req, 'report.export');
  const range = resolveRange(parseQuery(req, rangeSchema));

  const orders = await prisma.order.findMany({
    where: { placedAt: { gte: range.start, lt: range.end } },
    orderBy: { placedAt: 'asc' },
    take: MAX_EXPORT_ROWS + 1,
    select: {
      orderNumber: true,
      placedAt: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      subtotal: true,
      discountTotal: true,
      shippingTotal: true,
      taxTotal: true,
      grandTotal: true,
      refundedTotal: true,
      couponCode: true,
    },
  });

  if (orders.length > MAX_EXPORT_ROWS) {
    throw new ValidationError(
      `That range has more than ${MAX_EXPORT_ROWS.toLocaleString('en')} orders. Pick a shorter one.`,
    );
  }

  const header = [
    'Order number',
    'Placed (Pakistan time)',
    'Status',
    'Payment method',
    'Payment status',
    'Subtotal (Rs)',
    'Discount (Rs)',
    'Delivery (Rs)',
    'Tax (Rs)',
    'Total (Rs)',
    'Refunded (Rs)',
    'Coupon',
  ];

  const rows = orders.map((order) =>
    [
      order.orderNumber,
      shopDateTime(order.placedAt),
      order.status,
      order.paymentMethod,
      order.paymentStatus,
      rupees(order.subtotal),
      rupees(order.discountTotal),
      rupees(order.shippingTotal),
      rupees(order.taxTotal),
      rupees(order.grandTotal),
      rupees(order.refundedTotal),
      order.couponCode,
    ]
      .map(csvCell)
      .join(','),
  );

  await recordAudit({
    actor: actorFrom(actor),
    action: 'report.export',
    entityType: 'Report',
    summary: `Downloaded ${orders.length} orders from ${range.from} to ${range.to}`,
    after: { from: range.from, to: range.to, rows: orders.length },
    ip: ipHash(req),
    userAgent: req.get('user-agent') ?? null,
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="momishop-orders-${range.from}-to-${range.to}.csv"`,
  );
  // The byte-order mark tells Excel the file is UTF-8, so "Rs" and names survive.
  res.send(`﻿${[header.map(csvCell).join(','), ...rows].join('\r\n')}\r\n`);
});
