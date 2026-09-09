import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { getCategoryTree } from '@/server/catalogue';
import { getCartCount } from '@/server/cart';
import { getSessionUserId } from '@/server/session';
import { prisma } from '@/lib/db';
import { CACHE_KEYS, CACHE_TTL, cached } from '@/lib/cache';

/**
 * Storefront shell.
 *
 * The category tree and announcement bar are cached, so the per-request cost
 * of this layout is one cart-count query and one session read. Everything the
 * header needs is fetched here rather than in the header itself, keeping the
 * header a client component (it owns menu state) without making it fetch.
 */
async function getAnnouncement(): Promise<string | null> {
  return cached(`${CACHE_KEYS.homepageContent}:announcement`, CACHE_TTL.homepageContent, async () => {
    const block = await prisma.contentBlock.findFirst({
      where: {
        key: 'ANNOUNCEMENT_BAR',
        isActive: true,
        OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }] }],
      },
      select: { data: true },
    });

    const data = block?.data as { text?: string } | undefined;
    return data?.text ?? null;
  });
}

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const [categories, cartCount, userId, announcement] = await Promise.all([
    getCategoryTree(),
    getCartCount(),
    getSessionUserId(),
    getAnnouncement(),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        categories={categories}
        cartCount={cartCount}
        isSignedIn={Boolean(userId)}
        announcement={announcement}
      />

      <main id="main-content" className="flex-1">
        {children}
      </main>

      <SiteFooter categories={categories} />
    </div>
  );
}
