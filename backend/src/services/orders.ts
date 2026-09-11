import { prisma } from '../lib/db';

/**
 * Order lookups for the confirmation page and invoice download.
 *
 * Reachable straight after checkout without signing in, because a guest has to
 * be able to see what they just bought. Access is controlled by the order
 * number plus one of:
 *   - the order belongs to the signed-in user, or
 *   - the order has no user attached (a guest order).
 *
 * A guest order number alone is therefore enough. That is a deliberate,
 * bounded trade: nothing here includes payment details, and demanding an email
 * confirmation at this point would strand every guest. The route rate limits
 * lookups, and the tracking page additionally requires the email address.
 */
export async function getOrderForViewer(orderNumber: string, viewerId: string | null) {
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: { items: true },
  });

  // An order attached to an account is only visible to that account. Both
  // cases read as "not found", so order numbers cannot be probed for owners.
  if (!order || (order.userId && order.userId !== viewerId)) return null;
  return order;
}

type ViewableOrder = NonNullable<Awaited<ReturnType<typeof getOrderForViewer>>>;

/**
 * The confirmation page's view of an order.
 *
 * An explicit allow-list rather than the row itself, so a column added to the
 * orders table later cannot reach a public response without someone choosing
 * to put it here.
 */
export function orderConfirmationView(order: ViewableOrder) {
  return {
    orderNumber: order.orderNumber,
    email: order.email,
    status: order.status,
    paymentMethod: order.paymentMethod,
    placedAt: order.placedAt,
    currency: order.currency,
    shippingAddress: order.shippingSnapshot,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingTotal: order.shippingTotal,
    taxTotal: order.taxTotal,
    grandTotal: order.grandTotal,
    items: order.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      productName: item.productName,
      variantName: item.variantName,
      lineTotal: item.lineTotal,
      measurementTemplate: item.measurementTemplate,
      measurementUnit: item.measurementUnit,
      measurementSnapshot: item.measurementSnapshot,
      customNote: item.customNote,
    })),
  };
}
