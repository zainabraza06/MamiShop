import { handlers } from '@/auth';

/**
 * NextAuth's own endpoints (sign-in, callback, session, CSRF).
 *
 * Auth.js issues and verifies its own CSRF token on every state-changing
 * request through these handlers, which is why the sign-in form posts here
 * rather than to a hand-rolled route.
 */
export const { GET, POST } = handlers;
