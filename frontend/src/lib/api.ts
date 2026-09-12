import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import type { ApiErrorBody } from '@momishop/shared/api-types';
import { apiBaseUrl } from '@/lib/env';

/**
 * API calls from server components, made on behalf of the visitor.
 *
 * Server components call the API directly rather than through the /api
 * rewrite the browser uses, which saves a network hop. Two things are passed
 * along so the API treats the call exactly as it would one from the browser:
 *
 *   - the visitor's cookies, so it sees the same session and cart;
 *   - the visitor's address, as X-Forwarded-For, so rate limits apply to each
 *     visitor rather than to the storefront server as a whole. The API only
 *     believes that header from a proxy it is configured to trust.
 *
 * GETs are deduplicated per render with React's `cache`: a layout, a page and
 * its metadata can all ask for the same resource and the API sees one request.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const fetchFromApi = cache(async (path: string): Promise<{ status: number; body: unknown }> => {
  const [cookieStore, incoming] = await Promise.all([cookies(), headers()]);

  const forwarded: Record<string, string> = { Accept: 'application/json' };

  const cookieHeader = cookieStore.toString();
  if (cookieHeader) forwarded.Cookie = cookieHeader;

  const clientAddress = incoming.get('x-forwarded-for') ?? incoming.get('x-real-ip');
  if (clientAddress) forwarded['X-Forwarded-For'] = clientAddress;

  const userAgent = incoming.get('user-agent');
  if (userAgent) forwarded['User-Agent'] = userAgent;

  const response = await fetch(`${apiBaseUrl()}/api${path}`, {
    headers: forwarded,
    // Per-visitor data, so never kept in Next's data cache.
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });

  return { status: response.status, body: await response.json().catch(() => null) };
});

/** The response body, or an ApiError for any non-2xx status. */
export async function apiGet<T>(path: string): Promise<T> {
  const { status, body } = await fetchFromApi(path);
  if (status >= 200 && status < 300) return body as T;

  const error = body as Partial<ApiErrorBody> | null;
  throw new ApiError(
    status,
    error?.code ?? 'UNKNOWN',
    error?.error ?? `The API answered ${status} for ${path}`,
  );
}

/** Like apiGet, but a 404 resolves to null so the page can call notFound(). */
export async function apiGetOrNull<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
