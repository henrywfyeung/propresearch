// Sign-out (POST). Clears the Supabase session cookies, then redirects to
// /login. POST-only so a stray GET / prefetch can't log users out.

import { createSupabaseServerClient } from '@/lib/auth/server';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
