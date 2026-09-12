import { Prisma } from '@prisma/client';
import {
  STATUS_PRESENTATION,
  allowedTransitions,
  canTransition,
  paymentStatusAfterRefund,
  type OrderStatus,
} from '@momishop/shared/order-status';
import { prisma } from '../lib/db';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { logger } from '../lib/logger';
import { recordAudit, type AuditActor } from './audit';
import { enqueue } from './jobs';

/**
 * Staff-side changes to an order.
 *
 * Two rules run through all of it. Every state change goes through the shared
 * state machine, so a misclick cannot move a delivered order back into
 * production or cancel a parcel already with the courier. And every change
 * happens in one transaction with its ledger row, its event and its audit
 * entry — a restock without the ledger line to explain it is how stock counts
 * quietly stop matching the shelf.
 */

interface Context {
  actor: AuditActor | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface StatusChangeInput {
  orderId: string;
  status: OrderStatus;
  trackingNumber?: string;
  courier?: string;
  note?: string;
  notifyCustomer: boolean;
}

/** Puts stock back on the shelf, with a ledger row explaining why. */
async function restock(
  tx: Prisma.TransactionClient,
  order: {
    id: string;
    orderNumber: string;
    items: { variantId: string | null; quantity: number }[];
  },
  reason: string,
  actorId: string | null,
): Promise<void> {
  for (const item of order.items) {
    if (!item.variantId) continue;

    await tx.productVariant.update({
      where: { id: item.variantId },
      data: { stockOnHand: { increment: item.quantity } },
    });

    await tx.inventoryLedger.create({
      data: {
        variantId: item.variantId,
        delta: item.quantity,
        reason,
        reference: order.orderNumber,
        actorId,
      },
    });
  }
}

/**
 * Moves an order to a new status.
 *
 * Notifications are queued inside the transaction as outbox rows, so a
 * customer can never be told their parcel shipped by a transaction that then
 * rolled back.
 */
export async function changeOrderStatus(
  input: StatusChangeInput,
  ctx: Context,
): Promise<{ id: string; status: OrderStatus }> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      phone: true,
      items: { select: { variantId: true, quantity: true } },
    },
  });

  if (!order) throw new NotFoundError('Order');

  const from = order.status as OrderStatus;
  if (from === input.status) {
    throw new ConflictError(
      `This order is already ${STATUS_PRESENTATION[from].label.toLowerCase()}.`,
    );
  }
  if (!canTransition(from, input.status)) {
    const allowed = allowedTransitions(from).map((s) => STATUS_PRESENTATION[s].label);
    throw new ConflictError(
      allowed.length === 0
        ? `A ${STATUS_PRESENTATION[from].label.toLowerCase()} order cannot change status.`
        : `That order can only move to: ${allowed.join(', ')}.`,
    );
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: input.status,
        ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
        ...(input.courier ? { courier: input.courier } : {}),
        ...(input.status === 'SHIPPED' ? { shippedAt: now } : {}),
        ...(input.status === 'DELIVERED' ? { deliveredAt: now } : {}),
        ...(input.status === 'CANCELLED' ? { cancelledAt: now, cancelReason: input.note } : {}),
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        status: input.status,
        title: STATUS_PRESENTATION[input.status].label,
        description: input.note,
        // The customer sees this on their tracking page, so it carries the
        // staff note only when the note was meant for them.
        isPublic: true,
        actorId: ctx.actor?.id ?? null,
      },
    });

    // A cancelled order never ships, so its reserved stock goes back.
    if (input.status === 'CANCELLED') {
      await restock(tx, order, 'ORDER_CANCELLED', ctx.actor?.id ?? null);
    }

    if (input.notifyCustomer) {
      /**
       * Only job types with a handler are queued. The others in `JobType` —
       * delivered, cancelled and refund emails — have no template yet, and
       * queueing one would land it in DEAD rather than in an inbox.
       */
      if (input.status === 'SHIPPED') {
        await enqueue(
          'email.order_shipped',
          { orderId: order.id },
          { priority: 7, idempotencyKey: `shipped:${order.id}` },
          tx,
        );
        await enqueue('sms.order_shipped', { orderId: order.id }, { priority: 6 }, tx);
      }
      if (input.status === 'DELIVERED') {
        await enqueue('sms.order_delivered', { orderId: order.id }, { priority: 4 }, tx);
      }
    }

    await recordAudit(
      {
        actor: ctx.actor,
        action: input.status === 'CANCELLED' ? 'order.cancel' : 'order.status_change',
        entityType: 'Order',
        entityId: order.id,
        summary: `${order.orderNumber}: ${from} → ${input.status}`,
        before: { status: from },
        after: {
          status: input.status,
          trackingNumber: input.trackingNumber,
          courier: input.courier,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      tx,
    );
  });

  logger.info('Order status changed', {
    orderNumber: order.orderNumber,
    from,
    to: input.status,
    actorId: ctx.actor?.id,
  });

  return { id: order.id, status: input.status };
}

export interface RefundInput {
  orderId: string;
  amount: number;
  reason: string;
  restock: boolean;
}

/**
 * Records a refund against an order.
 *
 * This writes what happened; it does not move money. The gateway adapters are
 * not built yet (see docs/ROADMAP.md), so a refund is made in the payment
 * provider — or in cash, for COD — and recorded here. Writing it down is what
 * keeps the order, the ledger and the reports agreeing.
 */
export async function refundOrder(
  input: RefundInput,
  ctx: Context,
): Promise<{ refundedTotal: number; paymentStatus: string }> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      grandTotal: true,
      refundedTotal: true,
      currency: true,
      paymentMethod: true,
      items: { select: { variantId: true, quantity: true } },
    },
  });

  if (!order) throw new NotFoundError('Order');

  const remaining = order.grandTotal - order.refundedTotal;
  if (remaining <= 0) throw new ConflictError('This order has already been refunded in full.');
  if (input.amount > remaining) {
    throw new ValidationError(
      `That is more than the ${remaining} remaining on this order, in minor units.`,
    );
  }

  const refundedTotal = order.refundedTotal + input.amount;
  const paymentStatus = paymentStatusAfterRefund(order.grandTotal, refundedTotal);
  // A fully refunded order follows its money, where the state machine allows.
  const movesToRefunded =
    paymentStatus === 'REFUNDED' && canTransition(order.status as OrderStatus, 'REFUNDED');

  await prisma.$transaction(async (tx) => {
    await tx.paymentTransaction.create({
      data: {
        orderId: order.id,
        method: order.paymentMethod,
        kind: 'REFUND',
        status: 'SUCCEEDED',
        amount: input.amount,
        currency: order.currency,
        errorMessage: null,
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        refundedTotal,
        paymentStatus,
        ...(movesToRefunded ? { status: 'REFUNDED' } : {}),
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        status: movesToRefunded ? 'REFUNDED' : (order.status as OrderStatus),
        title: refundedTotal >= order.grandTotal ? 'Refunded' : 'Partially refunded',
        description: input.reason,
        isPublic: true,
        actorId: ctx.actor?.id ?? null,
      },
    });

    if (input.restock) {
      await restock(tx, order, 'RETURN_RESTOCK', ctx.actor?.id ?? null);
    }

    await recordAudit(
      {
        actor: ctx.actor,
        action: 'order.refund',
        entityType: 'Order',
        entityId: order.id,
        summary: `${order.orderNumber}: refunded ${input.amount} ${order.currency}`,
        before: { refundedTotal: order.refundedTotal },
        after: { refundedTotal, reason: input.reason, restocked: input.restock },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      tx,
    );
  });

  logger.info('Refund recorded', {
    orderNumber: order.orderNumber,
    amount: input.amount,
    refundedTotal,
    actorId: ctx.actor?.id,
  });

  return { refundedTotal, paymentStatus };
}

/** A staff-only note on an order. Never shown to the customer. */
export async function setStaffNote(orderId: string, note: string, ctx: Context): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, staffNote: true },
  });
  if (!order) throw new NotFoundError('Order');

  await prisma.order.update({ where: { id: order.id }, data: { staffNote: note } });

  await recordAudit({
    actor: ctx.actor,
    action: 'order.note',
    entityType: 'Order',
    entityId: order.id,
    summary: `${order.orderNumber}: staff note updated`,
    before: { staffNote: order.staffNote },
    after: { staffNote: note },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}
