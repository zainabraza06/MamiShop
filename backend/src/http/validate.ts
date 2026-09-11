import type { Request } from 'express';
import type { ZodTypeAny, output } from 'zod';
import { AppError } from '../lib/errors';

/**
 * Validates a JSON body.
 *
 * `express.json()` leaves the body undefined when the request was not sent as
 * JSON. That is rejected with a 400 here rather than handed to the schema,
 * where it would produce a confusing "expected object, received undefined".
 *
 * Generic over the schema so the result is the post-transform type: a field
 * with `.default()` is non-optional after parsing.
 */
export function parseBody<S extends ZodTypeAny>(req: Request, schema: S): output<S> {
  if (req.body === undefined) {
    throw new AppError('The request body could not be read as JSON.', {
      status: 400,
      code: 'INVALID_JSON',
    });
  }
  return schema.parse(req.body);
}

/** Validates the query string. Repeated keys arrive as arrays. */
export function parseQuery<S extends ZodTypeAny>(req: Request, schema: S): output<S> {
  return schema.parse(req.query);
}
