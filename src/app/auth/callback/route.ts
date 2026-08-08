// OAuth callback (Node runtime — uses Drizzle via the allow-list check).
//
// This is the PRIMARY allow-list gate (CLAUDE.md §10.2 / [R5]): no session
// cookie is issued unless the verified email is on the allow-list.

export const runtime = 'nodejs';

import { isAllowed } from '@/lib/auth/allowlist';
import {
  NONCE_COOKIE,
  STATE_COOKIE,
  exchangeCodeForIdentity,
  handshakeCookieOptions,
} from '@/lib/auth/google-oauth';
import { requestOrigin } from '@/lib/auth/origin';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '@/lib/auth/session';
import { upsertUser } from '@/lib/auth/user';
import { logger } from '@/lib/observability/logger';
import { type NextRequest, NextResponse } from 'next/server';

/** Clear the handshake cookies whichever way this request ends. */
function withHandshakeCleared(response: NextResponse): NextResponse {
  response.cookies.set(STATE_COOKIE, '', { ...handshakeCookieOptions, maxAge: 0 });
  response.cookies.set(NONCE_COOKIE, '', { ...handshakeCookieOptions, maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const { searchParams } = new URL(request.url);

  const code = searchParams.get('code');
  const oauthError = searchParams.get('error');
  const state = searchParams.get('state');

  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  const expectedNonce = request.cookies.get(NONCE_COOKIE)?.value;

  if (oauthError || !code) {
    logger.warn({ oauthError }, 'OAuth callback without code');
    return withHandshakeCleared(NextResponse.redirect(`${origin}/login?error=oauth`));
  }

  // CSRF: the state we issued must come back. A missing cookie means the
  // handshake did not start here (or expired).
  if (!state || !expectedState || state !== expectedState || !expectedNonce) {
    logger.warn(
      { hasState: Boolean(state), hasCookie: Boolean(expectedState) },
      'OAuth callback state mismatch',
    );
    return withHandshakeCleared(NextResponse.redirect(`${origin}/login?error=oauth`));
  }

  let identity: Awaited<ReturnType<typeof exchangeCodeForIdentity>>;
  try {
    identity = await exchangeCodeForIdentity(origin, code, expectedNonce);
  } catch (err) {
    logger.warn({ err: String(err) }, 'code exchange failed');
    return withHandshakeCleared(NextResponse.redirect(`${origin}/login?error=oauth`));
  }

  if (!identity) {
    logger.warn('ID token verification failed');
    return withHandshakeCleared(NextResponse.redirect(`${origin}/login?error=oauth`));
  }

  // An unverified address must never satisfy an allow-list keyed on email.
  if (!identity.emailVerified) {
    logger.warn({ sub: identity.sub }, 'sign-in blocked: email not verified');
    return withHandshakeCleared(NextResponse.redirect(`${origin}/login?error=not_allowed`));
  }

  if (!(await isAllowed(identity.email))) {
    logger.warn({ sub: identity.sub }, 'sign-in blocked: email not allow-listed');
    return withHandshakeCleared(NextResponse.redirect(`${origin}/login?error=not_allowed`));
  }

  const userId = await upsertUser(identity.email);
  logger.info({ userId }, 'sign-in succeeded');

  const token = await signSession({ uid: userId, email: identity.email });

  const response = withHandshakeCleared(NextResponse.redirect(`${origin}/`));
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return response;
}
