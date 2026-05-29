// Root middleware (Edge runtime). Refreshes the Supabase session on every
// request and redirects unauthenticated traffic to /login.
//
// The allow-list DB re-check is NOT here — Edge can't reach Postgres via
// postgres-js. It lives in requireAllowedUser() (Node runtime), called by
// protected layouts/pages. See src/lib/auth/middleware.ts for the rationale
// and CLAUDE.md §10.3.

import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/auth/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Exclude static assets, the Inngest webhook (own signature auth, [R45]),
  // and image files. /login and /auth/* are handled inside updateSession.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/inngest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
};
