// Sign-out (POST). Clears the session cookie, then redirects to /login.
// POST-only so a stray GET or link prefetch cannot log users out.

export const runtime = 'nodejs';

import { requestOrigin } from '@/lib/auth/origin';
import { SESSION_COOKIE, clearedCookieOptions } from '@/lib/auth/session';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(`${requestOrigin(request)}/login`, { status: 303 });
  response.cookies.set(SESSION_COOKIE, '', clearedCookieOptions);
  return response;
}
