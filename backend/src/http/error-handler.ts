import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { RateLimitError, isAppError } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * How errors become responses.
 *
 * One place decides, which is what keeps the API from leaking internals. An
 * `AppError` marked `expose` shows its message; anything else becomes a
 * generic 500 with a correlation id, and the real error goes to the logs. A
 * stack trace or a Prisma constraint name in a JSON response tells an attacker
 * about the schema.
 *
 * Express 5 forwards rejected promises from async handlers here, so routes
 * simply throw.
 */

export interface ApiErrorBody {
  error: string;
  code: string;
  details?: unknown;
  issues?: { field: string; message: string }[];
  requestId?: string;
}

export interface ErrorResponse {
  status: number;
  body: ApiErrorBody;
  headers?: Record<string, string>;
}

/** body-parser tags malformed and oversized bodies with a `type`. */
function bodyParserFailure(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const type = (error as { type?: unknown }).type;
  return typeof type === 'string' ? type : null;
}

export function toErrorResponse(
  error: unknown,
  context: Record<string, unknown> = {},
): ErrorResponse {
  // Zod errors are flattened into field-level messages, because a form needs
  // to know which input failed, not just that something did.
  if (error instanceof ZodError) {
    return {
      status: 422,
      body: {
        error: 'Please check the highlighted fields.',
        code: 'VALIDATION_ERROR',
        issues: error.issues.map((issue) => ({
          field: issue.path.join('.') || 'form',
          message: issue.message,
        })),
      },
    };
  }

  if (error instanceof RateLimitError) {
    return {
      status: 429,
      body: { error: error.message, code: error.code },
      headers: { 'Retry-After': String(error.retryAfterSeconds) },
    };
  }

  if (isAppError(error)) {
    if (error.status >= 500) {
      logger.error('Unhandled application error', { ...context, error });
    }
    return {
      status: error.status,
      body: {
        error: error.expose ? error.message : 'Something went wrong. Please try again.',
        code: error.code,
        ...(error.expose && error.details ? { details: error.details } : {}),
      },
    };
  }

  const parserFailure = bodyParserFailure(error);
  if (parserFailure === 'entity.parse.failed') {
    return {
      status: 400,
      body: { error: 'The request body could not be read as JSON.', code: 'INVALID_JSON' },
    };
  }
  if (parserFailure === 'entity.too.large') {
    return {
      status: 413,
      body: { error: 'The request body is too large.', code: 'PAYLOAD_TOO_LARGE' },
    };
  }

  // Unknown failure: log everything, tell the caller nothing beyond an id.
  const requestId = randomUUID();
  logger.error('Unexpected error in API route', { ...context, requestId, error });

  return {
    status: 500,
    body: {
      error: 'Something went wrong on our side. Please try again.',
      code: 'INTERNAL_ERROR',
      requestId,
    },
  };
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const { status, body, headers } = toErrorResponse(error, {
    method: req.method,
    path: req.path,
  });
  if (headers) res.set(headers);
  res.status(status).json(body);
};

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'There is no such endpoint.', code: 'NOT_FOUND' });
};
