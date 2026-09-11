import { Router } from 'express';
import { z } from 'zod';
import { cuidSchema } from '@momishop/shared/validation';
import { prisma } from '../lib/db';
import { NotFoundError } from '../lib/errors';
import { requireUser } from '../auth/current-user';
import { rateLimit } from '../http/request';
import { parseBody } from '../http/validate';
import { productCardSelect } from '../services/catalogue';

/** A signed-in customer's saved products. */
export const wishlistRouter = Router();

const wishlistItemSchema = z.object({ productId: cuidSchema });

wishlistRouter.get('/wishlist', async (req, res) => {
  const user = await requireUser(req);

  const rows = await prisma.wishlistItem.findMany({
    // A product archived after it was saved simply drops off the list.
    where: { userId: user.id, product: { status: 'ACTIVE', archivedAt: null } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { product: { select: productCardSelect } },
  });

  res.json({ items: rows.map((row) => row.product) });
});

/** Saves a product. Idempotent: saving twice is not an error. */
wishlistRouter.post('/wishlist', async (req, res) => {
  const user = await requireUser(req);
  await rateLimit(req, 'api', user.id);

  const { productId } = parseBody(req, wishlistItemSchema);

  const product = await prisma.product.findFirst({
    where: { id: productId, status: 'ACTIVE', archivedAt: null },
    select: { id: true },
  });
  if (!product) throw new NotFoundError('Product');

  await prisma.wishlistItem.upsert({
    where: { userId_productId: { userId: user.id, productId } },
    create: { userId: user.id, productId },
    update: {},
  });

  res.status(201).json({ ok: true });
});

wishlistRouter.delete('/wishlist/:productId', async (req, res) => {
  const user = await requireUser(req);
  await rateLimit(req, 'api', user.id);

  // Scoped to the caller, so one customer cannot empty another's list.
  await prisma.wishlistItem.deleteMany({
    where: { userId: user.id, productId: req.params.productId },
  });

  res.json({ ok: true });
});
