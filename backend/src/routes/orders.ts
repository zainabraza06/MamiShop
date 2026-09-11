import { Router } from 'express';
import { NotFoundError } from '../lib/errors';
import { getCurrentUser } from '../auth/current-user';
import { rateLimit, sessionUserId } from '../http/request';
import { generateInvoicePdf, invoiceDataFromOrder } from '../services/invoice';
import { getOrderForViewer, orderConfirmationView } from '../services/orders';

/**
 * Customer-facing order reads. See services/orders.ts for the access rule.
 *
 * Both are rate limited under the `search` policy. Order numbers are
 * sequential, so an unthrottled endpoint would let a script walk through
 * every guest order in turn.
 */
export const ordersRouter = Router();

ordersRouter.get('/orders/:orderNumber', async (req, res) => {
  await rateLimit(req, 'search', sessionUserId(req));

  const viewer = await getCurrentUser(req);
  const order = await getOrderForViewer(req.params.orderNumber, viewer?.id ?? null);
  if (!order) throw new NotFoundError('Order');

  res.json({ order: orderConfirmationView(order) });
});

/**
 * The invoice PDF, rendered on demand rather than stored. For a store this
 * size that is the right trade: no object storage to secure, expire or back
 * up, and an invoice always reflects the current order record.
 */
ordersRouter.get('/orders/:orderNumber/invoice', async (req, res) => {
  await rateLimit(req, 'search', sessionUserId(req));

  const viewer = await getCurrentUser(req);
  const order = await getOrderForViewer(req.params.orderNumber, viewer?.id ?? null);
  if (!order) throw new NotFoundError('Order');

  const pdf = await generateInvoicePdf(invoiceDataFromOrder(order));

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="invoice-${order.orderNumber}.pdf"`,
  });
  res.send(Buffer.from(pdf));
});
