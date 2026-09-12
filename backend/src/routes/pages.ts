import { Router } from 'express';
import { prisma } from '../lib/db';
import { NotFoundError } from '../lib/errors';

/**
 * Editorial pages — privacy policy, terms, returns, delivery.
 *
 * Content lives in the database rather than in the codebase so the owner can
 * correct a policy without a deploy, which matters when the policy is the thing
 * customers are told to rely on.
 */
export const pagesRouter = Router();

pagesRouter.get('/pages/:slug', async (req, res) => {
  const page = await prisma.page.findFirst({
    where: { slug: req.params.slug, isPublished: true },
    select: {
      slug: true,
      title: true,
      body: true,
      metaTitle: true,
      metaDescription: true,
      updatedAt: true,
    },
  });

  // An unpublished page reads as missing: a draft policy must not be reachable
  // by guessing its slug.
  if (!page) throw new NotFoundError('Page');

  // Identical for every visitor and edited rarely.
  res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
  res.json({ page });
});
