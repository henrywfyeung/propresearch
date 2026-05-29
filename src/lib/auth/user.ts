// Server-side user helpers (Node runtime — uses Drizzle).
//
// `requireAllowedUser` is the authorization gate for protected pages/actions.
// Because Next.js 15.0.3 middleware is Edge-only, the allow-list DB re-check
// can't run in middleware; instead every protected Server Component / Server
// Action calls this. It (a) confirms a valid Supabase session, (b) re-checks
// the allow-list with the 60s cache, (c) signs out + redirects on failure.
// This is the R5 revocation path; the callback (§10.2) is the primary gate.

import { db } from '@/db/client';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { isAllowedCached } from './allowlist';
import { createSupabaseServerClient } from './server';

export interface AuthedUser {
  id: string;
  email: string;
}

/** Returns the Supabase-authenticated user, or null. Does not check the allow-list. */
export async function getCurrentUser(): Promise<AuthedUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  return { id: user.id, email: user.email };
}

/**
 * Gate for protected surfaces. Redirects to /login when unauthenticated or
 * de-listed. Returns the local `users` row id (not the Supabase auth id) so
 * callers can FK into reports etc.
 */
export async function requireAllowedUser(): Promise<{ userId: string; email: string }> {
  const authed = await getCurrentUser();
  if (!authed) redirect('/login');

  if (!(await isAllowedCached(authed.email))) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    redirect('/login?error=not_allowed');
  }

  const userId = await upsertUser(authed.email, authed.id);
  return { userId, email: authed.email };
}

/**
 * Ensure a row exists in our local `users` table for this email. Idempotent.
 * Returns the local user id. Mirrors Supabase auth.users by email (§4.2).
 */
export async function upsertUser(email: string, _supabaseUserId?: string): Promise<string> {
  const normalized = email.trim().toLowerCase();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);

  if (existing[0]) {
    // Touch last_seen_at; cheap and useful for the dashboard.
    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, existing[0].id));
    return existing[0].id;
  }

  const inserted = await db
    .insert(users)
    .values({ email: normalized, lastSeenAt: new Date() })
    .returning({ id: users.id });

  // onConflict guard in case of a race between the select and insert.
  if (!inserted[0]) {
    const row = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1);
    return row[0]!.id;
  }
  return inserted[0].id;
}
