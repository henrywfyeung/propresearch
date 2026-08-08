// Starts the Google sign-in handshake.
//
// GET so the login page can be a plain link — no client-side SDK, and therefore
// no NEXT_PUBLIC_* client id baked into the browser bundle at build time.

export const runtime = 'nodejs';

import {
  NONCE_COOKIE,
  STATE_COOKIE,
  buildAuthUrl,
  handshakeCookieOptions,
  randomToken,
} from '@/lib/auth/google-oauth';
import { requestOrigin } from '@/lib/auth/origin';
import { logger } from '@/lib/observability/logger';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);

  const state = randomToken();
  const nonce = randomToken();

  let authUrl: string;
  try {
    authUrl = buildAuthUrl(origin, state, nonce);
  } catch (err) {
    // Misconfiguration (missing client id/secret) must not render a stack trace
    // to the visitor.
    logger.error({ err: String(err) }, 'cannot build Google auth URL');
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }

  const response = NextResponse.redirect(authUrl);
  // Both are read back in /auth/callback: state defends against CSRF, nonce
  // binds the returned ID token to this request.
  response.cookies.set(STATE_COOKIE, state, handshakeCookieOptions);
  response.cookies.set(NONCE_COOKIE, nonce, handshakeCookieOptions);
  return response;
}
