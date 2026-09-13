import type { StorefrontShell } from '@momishop/shared/api-types';
import { AssistantWidget } from '@/components/assistant/assistant-widget';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { apiGet } from '@/lib/api';

/**
 * Storefront shell.
 *
 * One API call returns everything the header and footer need. The API caches
 * the category tree and announcement, so the per-request cost is the visitor's
 * cart lookup. Fetched here rather than in the header, which stays a client
 * component (it owns menu state) without having to fetch.
 */
export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const { categories, cartCount, isSignedIn, announcement } =
    await apiGet<StorefrontShell>('/storefront/shell');

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        categories={categories}
        cartCount={cartCount}
        isSignedIn={isSignedIn}
        announcement={announcement}
      />

      <main id="main-content" className="flex-1">
        {children}
      </main>

      <SiteFooter categories={categories} />

      <AssistantWidget isSignedIn={isSignedIn} />
    </div>
  );
}
