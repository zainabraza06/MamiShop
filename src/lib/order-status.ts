import type { OrderStatus, PaymentStatus } from '@prisma/client';

/**
 * Order lifecycle.
 *
 * Modelled as an explicit state machine rather than a free-form status column.
 * Without it, an admin misclick can move a delivered order back into
 * production, or cancel something already shipped — both of which corrupt
 * revenue reporting and confuse the customer's tracking page.
 */

/** Legal transitions. Anything not listed here is rejected. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PRODUCTION', 'READY_TO_SHIP', 'CANCELLED'],
  IN_PRODUCTION: ['READY_TO_SHIP', 'CANCELLED'],
  READY_TO_SHIP: ['SHIPPED', 'CANCELLED'],
  // Once a parcel is with the courier it can only complete or be refunded;
  // "cancelled" would wrongly imply nothing ever left the workshop.
  SHIPPED: ['DELIVERED', 'REFUNDED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: OrderStatus): OrderStatus[] {
  return [...TRANSITIONS[from]];
}

export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Statuses that still count toward revenue. */
export function countsAsRevenue(status: OrderStatus): boolean {
  return status !== 'CANCELLED' && status !== 'REFUNDED';
}

/** Whether the customer can still request a return. */
export function returnsAllowed(
  status: OrderStatus,
  deliveredAt: Date | null,
  windowDays: number,
  now: Date,
): boolean {
  if (status !== 'DELIVERED' || !deliveredAt) return false;
  const deadline = new Date(deliveredAt);
  deadline.setDate(deadline.getDate() + windowDays);
  return now <= deadline;
}

/**
 * Whether a customer may cancel their own order.
 *
 * The cut-off is production, not payment: once fabric is cut to someone's
 * measurements the garment cannot be resold, so cancellation becomes a
 * returns conversation with a human rather than a self-service button.
 */
export function customerCancellable(status: OrderStatus): boolean {
  return status === 'PENDING' || status === 'CONFIRMED';
}

export interface StatusPresentation {
  label: string;
  /** Shown on the customer's tracking timeline. */
  customerDescription: string;
  tone: 'neutral' | 'progress' | 'success' | 'danger';
}

export const STATUS_PRESENTATION: Record<OrderStatus, StatusPresentation> = {
  PENDING: {
    label: 'Order placed',
    customerDescription: 'We have your order and are waiting for payment to clear.',
    tone: 'neutral',
  },
  CONFIRMED: {
    label: 'Confirmed',
    customerDescription: 'Payment received. Your order is queued with our workshop.',
    tone: 'progress',
  },
  IN_PRODUCTION: {
    label: 'Being stitched',
    customerDescription: 'Your pieces are being cut and stitched to your measurements.',
    tone: 'progress',
  },
  READY_TO_SHIP: {
    label: 'Ready to ship',
    customerDescription: 'Stitching is finished and your parcel is being packed.',
    tone: 'progress',
  },
  SHIPPED: {
    label: 'Shipped',
    customerDescription: 'Your parcel is on its way. Track it with the number below.',
    tone: 'progress',
  },
  DELIVERED: {
    label: 'Delivered',
    customerDescription: 'Your order has been delivered. We hope you love it.',
    tone: 'success',
  },
  CANCELLED: {
    label: 'Cancelled',
    customerDescription: 'This order was cancelled.',
    tone: 'danger',
  },
  REFUNDED: {
    label: 'Refunded',
    customerDescription: 'This order has been refunded.',
    tone: 'danger',
  },
};

/**
 * The timeline shown on the tracking page. Cancelled and refunded orders get
 * their own short timeline rather than a half-filled happy path.
 */
export const CUSTOMER_TIMELINE: OrderStatus[] = [
  'PENDING',
  'CONFIRMED',
  'IN_PRODUCTION',
  'READY_TO_SHIP',
  'SHIPPED',
  'DELIVERED',
];

export function timelineFor(status: OrderStatus): OrderStatus[] {
  if (status === 'CANCELLED') return ['PENDING', 'CANCELLED'];
  if (status === 'REFUNDED') return ['PENDING', 'CONFIRMED', 'REFUNDED'];
  return CUSTOMER_TIMELINE;
}

export function timelineProgress(status: OrderStatus): number {
  const timeline = timelineFor(status);
  const index = timeline.indexOf(status);
  if (index < 0) return 0;
  return Math.round(((index + 1) / timeline.length) * 100);
}

// ── Payment ──────────────────────────────────────────────────────────────────

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  UNPAID: ['AUTHORIZED', 'PAID', 'FAILED'],
  AUTHORIZED: ['PAID', 'FAILED', 'REFUNDED'],
  PAID: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  REFUNDED: [],
  // A failed attempt is not terminal: the customer can retry with another card.
  FAILED: ['UNPAID', 'AUTHORIZED', 'PAID'],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/**
 * Derives the payment status after a refund, so the caller never has to guess
 * whether a refund was partial.
 */
export function paymentStatusAfterRefund(
  grandTotal: number,
  refundedTotal: number,
): PaymentStatus {
  if (refundedTotal <= 0) return 'PAID';
  return refundedTotal >= grandTotal ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}
