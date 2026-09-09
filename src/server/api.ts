import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type output } from 'zod';
import { AppError, RateLimitError, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { enforceRateLimit, ipIdentifier, type RateLimitName } from '@/lib/rate-limit';

/**
 * Shared API plumbing.
 *
 * One place decides how errors become responses, which is what keeps the API
 * from leaking internals. The rule: an `AppError` marked `expose` shows its
 * message; anything else becomes a generic 500 with a correlation id, and the
 * real error goes to the logs. A stack trace or a Prisma constraint name in a
 * JSON response tells an attacker about your schema.
 */

export interface ApiErrorBody {
  error: string;
  code: string;
  details?: unknown;
  requestId?: string;
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { 'Cache-Control': 'no-store', ...(init?.headers ?? {}) },
  });
}

export function jsonError(
  message: string,
  status = 400,
  code = 'BAD_REQUEST',
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: message, code, details }, { status });
}

/**
 * Converts any thrown value into a safe response.
 *
 * Zod errors are flattened into field-level messages, because a form needs to
 * know *which* input failed, not just that something did.
 */
export function handleApiError(error: unknown, context: Record<string, unknown> = {}): NextResponse {
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({
      field: issue.path.join('.') || 'form',
      message: issue.message,
    }));
    return NextResponse.json(
      { error: 'Please check the highlighted fields.', code: 'VALIDATION_ERROR', issues },
      { status: 422 },
    );
  }

  if (error instanceof RateLimitError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 429, headers: { 'Retry-After': String(error.retryAfterSeconds) } },
    );
  }

  if (isAppError(error)) {
    if (error.status >= 500) {
      logger.error('Unhandled application error', { ...context, error });
    }
    return NextResponse.json(
      {
        error: error.expose ? error.message : 'Something went wrong. Please try again.',
        code: error.code,
        ...(error.expose && error.details ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  // Unknown failure: log everything, tell the caller nothing beyond an id.
  const requestId = crypto.randomUUID();
  logger.error('Unexpected error in API route', { ...context, requestId, error });

  return NextResponse.json(
    {
      error: 'Something went wrong on our side. Please try again.',
      code: 'INTERNAL_ERROR',
      requestId,
    },
    { status: 500 },
  );
}

/**
 * Parses and validates a JSON body.
 *
 * Rejects a malformed body with a 400 rather than letting `undefined` reach a
 * schema and produce a confusing "expected object, received undefined".
 */
export async function parseJsonBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('The request body could not be read as JSON.', {
      status: 400,
      code: 'INVALID_JSON',
    });
  }
  return schema.parse(raw);
}

/**
 * Parses and validates URL search params.
 *
 * Generic over the schema rather than its type argument so `output<S>` picks
 * up the post-transform type — a field with `.default()` or `.coerce` is
 * non-optional after parsing, and inferring the input type instead makes
 * every defaulted field look possibly-undefined at the call site.
 */
export function parseSearchParams<S extends ZodTypeAny>(request: Request, schema: S): output<S> {
  const url = new URL(request.url);
  const raw: Record<string, string | string[]> = {};

  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }

  return schema.parse(raw);
}

/**
 * Applies a rate limit keyed to the caller.
 *
 * `userId` is preferred when available: rate limiting a signed-in user by IP
 * punishes everyone behind the same office or mobile-carrier NAT.
 */
export async function rateLimit(
  request: Request,
  name: RateLimitName,
  userId?: string | null,
): Promise<void> {
  const identifier = userId ?? ipIdentifier(request.headers);
  await enforceRateLimit(name, identifier);
}

/**
 * Wraps a route handler with error handling.
 *
 * Every handler in this app is wrapped, so no route can accidentally return an
 * unhandled rejection (which Next.js renders as an opaque 500 with no log).
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response>,
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      return handleApiError(error, {
        method: request.method,
        path: new URL(request.url).pathname,
      });
    }
  };
}
