// Root middleware (Edge runtime). Verifies the signed session cookie and
// redirects unauthenticated traffic to /login.
//
// This used to call supabase.auth.getUser(), an HTTPS round trip to Supabase on
// EVERY request. Verification is now a local HMAC check, so the network hop is
// gone entirely.
//
// The allow-list DB re-check still does not happen here: Edge cannot reach
// Postgres via postgres-js. It lives in requireAllowedUser() (Node runtime),
// called by every protected layout/page — that is the revocation path. The
// split is now a deliberate performance choice rather than a platform
// workaround, since a DB round trip per request would be wasteful.

import { verifySession } from '@/lib/auth/session';
import { SESSION_COOKIE } from '@/lib/auth/session';
import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_PREFIXES = ['/login', '/auth'];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) {
    return NextResponse.next();
  }

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // Exclude static assets, the Inngest webhook (own signature auth, [R45]),
  // and image files. /login and /auth/* are handled inside the handler.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/inngest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
};
