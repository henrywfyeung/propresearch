// OAuth callback (Node runtime — uses Drizzle via the allow-list check).
// This is the PRIMARY allow-list gate (CLAUDE.md §10.2 / [R5]): no Supabase
// session survives this handler unless the email is on the allow-list.

import { isAllowed } from '@/lib/auth/allowlist';
import { createSupabaseServerClient } from '@/lib/auth/server';
import { upsertUser } from '@/lib/auth/user';
import { logger } from '@/lib/observability/logger';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const oauthError = searchParams.get('error');

  if (oauthError || !code) {
    logger.warn({ oauthError }, 'OAuth callback without code');
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user?.email) {
    logger.warn({ err: error?.message }, 'exchangeCodeForSession failed');
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }

  const email = data.user.email;

  if (!(await isAllowed(email))) {
    // Not on the list — kill the freshly-minted session immediately.
    await supabase.auth.signOut();
    logger.warn({ userId: data.user.id }, 'sign-in blocked: email not allow-listed');
    return NextResponse.redirect(`${origin}/login?error=not_allowed`);
  }

  await upsertUser(email, data.user.id);
  logger.info({ userId: data.user.id }, 'sign-in succeeded');

  return NextResponse.redirect(`${origin}/`);
}
