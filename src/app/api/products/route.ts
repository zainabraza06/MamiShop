import { listProducts } from '@/server/catalogue';
import { productFilterSchema } from '@/lib/validation';
import { jsonOk, parseSearchParams, rateLimit, withErrorHandling } from '@/server/api';

/**
 * Product listing API, used by "load more" and by the search box.
 *
 * Rate limited under the `search` policy: this endpoint is the cheapest way to
 * enumerate the whole catalogue, so it gets a tighter budget than a page view.
 */
export const GET = withErrorHandling(async (request) => {
  await rateLimit(request, 'search');

  const filter = parseSearchParams(request, productFilterSchema);
  const result = await listProducts(filter);

  return jsonOk(result, {
    headers: {
      // Safe to cache at the edge briefly: the response depends only on the
      // query string and contains no per-user data.
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
});
