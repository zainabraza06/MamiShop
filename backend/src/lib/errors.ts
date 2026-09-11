/**
 * Application error taxonomy.
 *
 * Every error carries an HTTP status and a stable machine-readable `code`, so
 * API responses stay consistent and the client can branch on `code` rather
 * than parsing prose. `expose` marks errors whose message is safe to show a
 * user — everything else is reported generically to avoid leaking internals.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly expose: boolean;
  readonly details?: unknown;

  constructor(
    message: string,
    options: { status?: number; code?: string; expose?: boolean; details?: unknown } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.status = options.status ?? 500;
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.expose = options.expose ?? this.status < 500;
    this.details = options.details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The submitted data is invalid.', details?: unknown) {
    super(message, { status: 422, code: 'VALIDATION_ERROR', details });
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'You need to sign in to continue.') {
    super(message, { status: 401, code: 'UNAUTHENTICATED' });
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to do that.') {
    super(message, { status: 403, code: 'FORBIDDEN' });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} was not found.`, { status: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'That action conflicts with the current state.') {
    super(message, { status: 409, code: 'CONFLICT' });
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = 'Too many requests. Please slow down.') {
    super(message, { status: 429, code: 'RATE_LIMITED' });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class PaymentError extends AppError {
  constructor(message = 'The payment could not be processed.', details?: unknown) {
    super(message, { status: 402, code: 'PAYMENT_FAILED', details });
  }
}

export class OutOfStockError extends AppError {
  constructor(itemName: string) {
    super(`${itemName} is no longer available in the requested quantity.`, {
      status: 409,
      code: 'OUT_OF_STOCK',
    });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
