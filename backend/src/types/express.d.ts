import type { SessionClaims } from '@momishop/shared/session-contract';

declare global {
  namespace Express {
    interface Request {
      /**
       * Verified session claims, set by the `authenticate` middleware.
       * `null` for an anonymous caller.
       */
      auth?: SessionClaims | null;
    }
  }
}

export {};
