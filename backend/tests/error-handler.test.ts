import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toErrorResponse } from '../src/http/error-handler';
import { AppError, NotFoundError, RateLimitError } from '../src/lib/errors';

/**
 * The error mapper decides what a caller learns when something goes wrong.
 * The property that matters most: an unexpected failure reveals nothing
 * beyond a correlation id.
 */

describe('toErrorResponse', () => {
  it('turns validation failures into field-level issues', () => {
    const { error } = z.object({ email: z.string().email() }).safeParse({ email: 'nope' });
    const response = toErrorResponse(error);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.issues).toEqual([{ field: 'email', message: expect.any(String) }]);
  });

  it('attributes a form-level validation failure to the form', () => {
    const { error } = z.string().safeParse(42);
    expect(toErrorResponse(error).body.issues?.[0].field).toBe('form');
  });

  it('tells a rate-limited caller when to retry', () => {
    const response = toErrorResponse(new RateLimitError(90));

    expect(response.status).toBe(429);
    expect(response.headers).toEqual({ 'Retry-After': '90' });
  });

  it('shows the message of an error meant for the caller', () => {
    const response = toErrorResponse(new NotFoundError('Order'));

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Order was not found.', code: 'NOT_FOUND' });
  });

  it('hides the message of a server-side application error', () => {
    const response = toErrorResponse(new AppError('Stripe key sk_live_123 rejected'));

    expect(response.status).toBe(500);
    expect(response.body.error).not.toContain('sk_live');
  });

  it('reports a malformed JSON body as a 400', () => {
    const response = toErrorResponse(
      Object.assign(new SyntaxError('Unexpected token'), {
        type: 'entity.parse.failed',
      }),
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_JSON');
  });

  it('reports an oversized body as a 413', () => {
    const response = toErrorResponse(
      Object.assign(new Error('too large'), {
        type: 'entity.too.large',
      }),
    );

    expect(response.status).toBe(413);
  });

  it('reveals nothing about an unexpected failure except a correlation id', () => {
    const response = toErrorResponse(
      new Error('duplicate key value violates unique constraint "users_email_key"'),
    );

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('users_email_key');
    expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
