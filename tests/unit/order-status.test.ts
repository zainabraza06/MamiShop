import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '@prisma/client';
import {
  allowedTransitions,
  canTransition,
  canTransitionPayment,
  countsAsRevenue,
  customerCancellable,
  isTerminal,
  paymentStatusAfterRefund,
  returnsAllowed,
  STATUS_PRESENTATION,
  timelineFor,
  timelineProgress,
} from '@/lib/order-status';

const ALL_STATUSES: OrderStatus[] = [
  'PENDING',
  'CONFIRMED',
  'IN_PRODUCTION',
  'READY_TO_SHIP',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
];

describe('order transitions', () => {
  it('walks the happy path end to end', () => {
    const path: OrderStatus[] = [
      'PENDING',
      'CONFIRMED',
      'IN_PRODUCTION',
      'READY_TO_SHIP',
      'SHIPPED',
      'DELIVERED',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('refuses to move an order backwards', () => {
    expect(canTransition('SHIPPED', 'IN_PRODUCTION')).toBe(false);
    expect(canTransition('DELIVERED', 'SHIPPED')).toBe(false);
    expect(canTransition('IN_PRODUCTION', 'PENDING')).toBe(false);
  });

  it('refuses to cancel an order already with the courier', () => {
    expect(canTransition('SHIPPED', 'CANCELLED')).toBe(false);
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });

  it('allows cancellation before dispatch', () => {
    for (const status of ['PENDING', 'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP'] as const) {
      expect(canTransition(status, 'CANCELLED')).toBe(true);
    }
  });

  it('allows a refund from shipped or delivered', () => {
    expect(canTransition('SHIPPED', 'REFUNDED')).toBe(true);
    expect(canTransition('DELIVERED', 'REFUNDED')).toBe(true);
  });

  it('treats cancelled and refunded as terminal', () => {
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('REFUNDED')).toBe(true);
    expect(allowedTransitions('CANCELLED')).toEqual([]);
  });

  it('never allows a transition to itself', () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('returns a defensive copy of the transition list', () => {
    const list = allowedTransitions('PENDING');
    list.push('DELIVERED');
    expect(allowedTransitions('PENDING')).not.toContain('DELIVERED');
  });
});

describe('revenue accounting', () => {
  it('excludes cancelled and refunded orders', () => {
    expect(countsAsRevenue('CANCELLED')).toBe(false);
    expect(countsAsRevenue('REFUNDED')).toBe(false);
  });

  it('includes every live status', () => {
    for (const status of [
      'PENDING',
      'CONFIRMED',
      'IN_PRODUCTION',
      'SHIPPED',
      'DELIVERED',
    ] as const) {
      expect(countsAsRevenue(status)).toBe(true);
    }
  });
});

describe('customer self-service cancellation', () => {
  it('stops once the garment is being cut', () => {
    expect(customerCancellable('PENDING')).toBe(true);
    expect(customerCancellable('CONFIRMED')).toBe(true);
    expect(customerCancellable('IN_PRODUCTION')).toBe(false);
    expect(customerCancellable('SHIPPED')).toBe(false);
  });
});

describe('returns window', () => {
  const delivered = new Date('2026-06-01T00:00:00Z');

  it('allows a return inside the window', () => {
    expect(returnsAllowed('DELIVERED', delivered, 7, new Date('2026-06-05T00:00:00Z'))).toBe(true);
  });

  it('refuses a return after the window closes', () => {
    expect(returnsAllowed('DELIVERED', delivered, 7, new Date('2026-06-20T00:00:00Z'))).toBe(false);
  });

  it('accepts a request on the final day', () => {
    expect(returnsAllowed('DELIVERED', delivered, 7, new Date('2026-06-08T00:00:00Z'))).toBe(true);
  });

  it('refuses a return on an undelivered order', () => {
    expect(returnsAllowed('SHIPPED', null, 7, new Date('2026-06-05T00:00:00Z'))).toBe(false);
    expect(returnsAllowed('DELIVERED', null, 7, new Date('2026-06-05T00:00:00Z'))).toBe(false);
  });
});

describe('customer timeline', () => {
  it('describes every status', () => {
    for (const status of ALL_STATUSES) {
      const presentation = STATUS_PRESENTATION[status];
      expect(presentation.label).toBeTruthy();
      expect(presentation.customerDescription.length).toBeGreaterThan(10);
    }
  });

  it('gives cancelled and refunded their own short timelines', () => {
    expect(timelineFor('CANCELLED')).toEqual(['PENDING', 'CANCELLED']);
    expect(timelineFor('REFUNDED')).toContain('REFUNDED');
    expect(timelineFor('SHIPPED')).toHaveLength(6);
  });

  it('reports progress that ends at 100%', () => {
    expect(timelineProgress('PENDING')).toBeLessThan(50);
    expect(timelineProgress('DELIVERED')).toBe(100);
    expect(timelineProgress('CANCELLED')).toBe(100);
  });
});

describe('payment status', () => {
  it('allows a retry after a failed attempt', () => {
    expect(canTransitionPayment('FAILED', 'PAID')).toBe(true);
  });

  it('refuses to un-refund', () => {
    expect(canTransitionPayment('REFUNDED', 'PAID')).toBe(false);
  });

  it('derives partial versus full refund', () => {
    expect(paymentStatusAfterRefund(100_000, 0)).toBe('PAID');
    expect(paymentStatusAfterRefund(100_000, 40_000)).toBe('PARTIALLY_REFUNDED');
    expect(paymentStatusAfterRefund(100_000, 100_000)).toBe('REFUNDED');
    // An over-refund (goodwill top-up) still reads as fully refunded.
    expect(paymentStatusAfterRefund(100_000, 120_000)).toBe('REFUNDED');
  });
});
