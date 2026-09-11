import { createHash } from 'node:crypto';
import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '../lib/db';
import { randomToken, safeEqual } from '../lib/crypto';
import type { AuthenticatedUser } from './credentials';

/**
 * Google sign-in: the OAuth 2.0 authorization-code flow with PKCE, finished by
 * verifying Google's signed ID token.
 *
 * The browser is bound to the attempt by a short-lived, signed state cookie
 * holding the `state` value and the PKCE verifier. A callback whose `state`
 * does not match that cookie is refused, which is what stops an attacker
 * finishing a sign-in in a victim's browser with the attacker's own code.
 */

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const STATE_AUDIENCE = 'momishop-oauth-state';
const STATE_TTL_SECONDS = 10 * 60;

export const OAUTH_STATE_COOKIE = 'momishop.oauth';
export const OAUTH_STATE_MAX_AGE_MS = STATE_TTL_SECONDS * 1000;

/** Error codes the sign-in page already knows how to explain. */
export type OAuthErrorCode =
  | 'Configuration'
  | 'AccessDenied'
  | 'OAuthAccountNotLinked'
  | 'AccountSuspended'
  | 'OAuthCallbackError';

export class OAuthSignInError extends Error {
  constructor(readonly code: OAuthErrorCode) {
    super(`Google sign-in failed: ${code}`);
    this.name = 'OAuthSignInError';
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function googleKeys() {
  jwks ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  return jwks;
}

function config() {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) throw new OAuthSignInError('Configuration');
  return { clientId, clientSecret };
}

function stateKey(): Uint8Array {
  return new TextEncoder().encode(process.env.AUTH_SECRET ?? '');
}

function redirectUri(): string {
  const base = process.env.API_PUBLIC_URL ?? process.env.APP_URL ?? 'http://localhost:3000';
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${trimmed}/api/auth/google/callback`;
}

/** Where to send the browser, and the state cookie to set before sending it. */
export async function beginGoogleSignIn(
  callbackUrl: string,
): Promise<{ url: string; stateCookie: string }> {
  const { clientId } = config();

  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();

  const now = Math.floor(Date.now() / 1000);
  const stateCookie = await new SignJWT({ state, verifier, callbackUrl })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(STATE_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + STATE_TTL_SECONDS)
    .sign(stateKey());

  return { url: url.toString(), stateCookie };
}

interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

async function readState(stateCookie: unknown) {
  if (typeof stateCookie !== 'string' || stateCookie.length === 0) {
    throw new OAuthSignInError('OAuthCallbackError');
  }

  try {
    const { payload } = await jwtVerify(stateCookie, stateKey(), {
      algorithms: ['HS256'],
      audience: STATE_AUDIENCE,
    });
    const { state, verifier, callbackUrl } = payload;
    if (typeof state !== 'string' || typeof verifier !== 'string') throw new Error('bad state');
    return { state, verifier, callbackUrl: typeof callbackUrl === 'string' ? callbackUrl : '/' };
  } catch {
    throw new OAuthSignInError('OAuthCallbackError');
  }
}

async function exchangeCode(code: string, verifier: string): Promise<GoogleProfile> {
  const { clientId, clientSecret } = config();

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });

  const body = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!response.ok || typeof body?.id_token !== 'string') {
    throw new OAuthSignInError('OAuthCallbackError');
  }

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(body.id_token, googleKeys(), {
      issuer: GOOGLE_ISSUERS,
      audience: clientId,
    }));
  } catch {
    throw new OAuthSignInError('OAuthCallbackError');
  }

  // An unverified Google address proves nothing about who owns the mailbox.
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    payload.email_verified !== true
  ) {
    throw new OAuthSignInError('AccessDenied');
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };
}

const userSelect = {
  id: true,
  email: true,
  name: true,
  image: true,
  role: true,
  status: true,
  permissions: true,
  deletedAt: true,
} as const;

/**
 * Finds or creates the account for a Google identity.
 *
 * An email that already has a password account is never linked
 * automatically. Doing so would let anyone who controls a Google account for
 * that address take over the existing account, so the customer is told to
 * sign in with their password instead.
 */
async function resolveUser(profile: GoogleProfile): Promise<AuthenticatedUser> {
  const linked = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider: 'google', providerAccountId: profile.sub } },
    select: { user: { select: userSelect } },
  });

  let user = linked?.user ?? null;

  if (!user) {
    const existing = await prisma.user.findUnique({
      where: { email: profile.email },
      select: { id: true },
    });
    if (existing) throw new OAuthSignInError('OAuthAccountNotLinked');

    user = await prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        image: profile.picture,
        // Google verified the address, so the account starts verified.
        emailVerified: new Date(),
        accounts: {
          create: { type: 'oidc', provider: 'google', providerAccountId: profile.sub },
        },
      },
      select: userSelect,
    });
  }

  if (user.deletedAt || user.status !== 'ACTIVE') {
    throw new OAuthSignInError('AccountSuspended');
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    role: user.role,
    status: user.status,
    permissions: user.permissions,
  };
}

export async function completeGoogleSignIn(params: {
  code: unknown;
  state: unknown;
  error: unknown;
  stateCookie: unknown;
}): Promise<{ user: AuthenticatedUser; callbackUrl: string }> {
  const saved = await readState(params.stateCookie);

  // The customer cancelled on Google's consent screen.
  if (params.error) throw new OAuthSignInError('AccessDenied');

  if (typeof params.state !== 'string' || !safeEqual(params.state, saved.state)) {
    throw new OAuthSignInError('OAuthCallbackError');
  }
  if (typeof params.code !== 'string' || params.code.length === 0) {
    throw new OAuthSignInError('OAuthCallbackError');
  }

  const profile = await exchangeCode(params.code, saved.verifier);
  const user = await resolveUser(profile);

  return { user, callbackUrl: saved.callbackUrl };
}
