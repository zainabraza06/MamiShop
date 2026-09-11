import { describe, expect, it } from 'vitest';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  OutOfStockError,
  PaymentError,
  RateLimitError,
  ValidationError,
  isAppError,
} from '@/lib/errors';

/**
 * The error taxonomy decides what an API response reveals.
 *
 * `expose` is the security-relevant property: an exposed error's message goes
 * to the client, anything else becomes a generic 500. A 5xx that accidentally
 * exposed its message could leak a query or a stack detail.
 */

describe('AppError', () => {
  it('defaults to a hidden 500', () => {
    const error = new AppError('database connection string was wrong');
    expect(error.status).toBe(500);
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.expose).toBe(false);
  });

  it('exposes client errors by default', () => {
    expect(new AppError('bad input', { status: 400 }).expose).toBe(true);
  });

  it('keeps an explicit expose decision', () => {
    expect(new AppError('internal', { status: 400, expose: false }).expose).toBe(false);
  });

  it('names itself after the subclass, which makes logs readable', () => {
    expect(new NotFoundError().name).toBe('NotFoundError');
  });
});

describe('subclasses', () => {
  it.each([
    [new ValidationError(), 422, 'VALIDATION_ERROR'],
    [new AuthenticationError(), 401, 'UNAUTHENTICATED'],
    [new AuthorizationError(), 403, 'FORBIDDEN'],
    [new NotFoundError('Order'), 404, 'NOT_FOUND'],
    [new ConflictError(), 409, 'CONFLICT'],
    [new PaymentError(), 402, 'PAYMENT_FAILED'],
    [new OutOfStockError('Noor Abaya'), 409, 'OUT_OF_STOCK'],
    [new RateLimitError(30), 429, 'RATE_LIMITED'],
  ])('%s maps to %i %s', (error, status, code) => {
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.expose).toBe(true);
    expect(error).toBeInstanceOf(AppError);
  });

  it('names the missing resource', () => {
    expect(new NotFoundError('Product').message).toBe('Product was not found.');
  });

  it('carries the retry delay', () => {
    expect(new RateLimitError(45).retryAfterSeconds).toBe(45);
  });
});

describe('isAppError', () => {
  it('recognises the taxonomy and nothing else', () => {
    expect(isAppError(new NotFoundError())).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('a string')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});
