import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { ConflictError } from '../lib/errors';
import { requireUser } from '../auth/current-user';
import { rateLimit } from '../http/request';
import { parseBody } from '../http/validate';

/**
 * A customer's own account.
 *
 * Every route here starts with requireUser(), which re-reads the live user row,
 * and every query is scoped to that user's id — never to an id from the
 * request, which is how one customer ends up reading another's orders.
 */
export const accountRouter = Router();

/** Everything the account landing page shows, in one call. */
accountRouter.get('/account/overview', async (req, res) => {
  const user = await requireUser(req);

  const [orders, wishlistCount, measurementProfiles, loyalty] = await Promise.all([
    prisma.order.findMany({
      where: { userId: user.id },
      orderBy: { placedAt: 'desc' },
      take: 5,
      select: {
        orderNumber: true,
        status: true,
        placedAt: true,
        grandTotal: true,
        currency: true,
      },
    }),
    prisma.wishlistItem.count({
      where: { userId: user.id, product: { status: 'ACTIVE', archivedAt: null } },
    }),
    prisma.measurementProfile.count({ where: { userId: user.id, deletedAt: null } }),
    prisma.loyaltyAccount.findUnique({
      where: { userId: user.id },
      select: { balance: true },
    }),
  ]);

  res.json({
    user: { name: user.name, email: user.email },
    orders,
    wishlistCount,
    measurementProfileCount: measurementProfiles,
    loyaltyBalance: loyalty?.balance ?? 0,
  });
});

const dataRequestSchema = z.object({
  kind: z.enum(['EXPORT', 'DELETE']),
});

/**
 * Data export and erasure requests.
 *
 * Recorded rather than executed on the spot: an export has to be assembled and
 * delivered somewhere safe, and an erasure has to be reconciled with the orders
 * we are legally required to keep (see docs/DATA_RETENTION.md). Both are
 * therefore queued for a human, and the customer can see the state of theirs.
 */
accountRouter.get('/account/data-requests', async (req, res) => {
  const user = await requireUser(req);

  const requests = await prisma.dataRequest.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      kind: true,
      status: true,
      createdAt: true,
      completedAt: true,
      downloadUrl: true,
      expiresAt: true,
    },
  });

  res.json({ requests });
});

accountRouter.post('/account/data-requests', async (req, res) => {
  const user = await requireUser(req);
  await rateLimit(req, 'contact', user.id);

  const { kind } = parseBody(req, dataRequestSchema);

  // One open request of each kind: asking twice does not make it happen twice,
  // and a queue of duplicates only obscures the real one.
  const open = await prisma.dataRequest.findFirst({
    where: { userId: user.id, kind, status: { in: ['PENDING', 'PROCESSING'] } },
    select: { id: true },
  });
  if (open) {
    throw new ConflictError(
      'That request is already in progress. We will email you when it is done.',
    );
  }

  const request = await prisma.dataRequest.create({
    data: { userId: user.id, kind },
    select: { id: true, kind: true, status: true, createdAt: true },
  });

  res.status(201).json({ request });
});
