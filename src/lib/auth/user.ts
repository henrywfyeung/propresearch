// Server-side user helpers (Node runtime — uses Drizzle).
//
// `requireAllowedUser` is the authorization gate for protected pages/actions.
// Middleware verifies the session signature but cannot reach Postgres from the
// Edge runtime, so the allow-list re-check lives here and every protected
// Server Component / Server Action calls it. It (a) verifies the session
// cookie, (b) re-checks the allow-list with the 60s cache, (c) clears the
// cookie and redirects on failure. This is the R5 revocation path; the callback
// (§10.2) is the primary gate.

import { db } from '@/db/client';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isAllowedCached } from './allowlist';
import { SESSION_COOKIE, clearedCookieOptions, verifySession } from './session';

export interface AuthedUser {
  id: string;
  email: string;
}

/** Returns the session-authenticated user, or null. Does not check the allow-list. */
export async function getCurrentUser(): Promise<AuthedUser | null> {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return { id: session.uid, email: session.email };
}

/**
 * Gate for protected surfaces. Redirects to /login when unauthenticated or
 * de-listed. Returns the local `users` row id so callers can FK into reports.
 */
export async function requireAllowedUser(): Promise<{ userId: string; email: string }> {
  const authed = await getCurrentUser();
  if (!authed) redirect('/login');

  if (!(await isAllowedCached(authed.email))) {
    // Revocation: drop the cookie so the next request is unauthenticated
    // rather than looping through this check.
    const store = await cookies();
    store.set(SESSION_COOKIE, '', clearedCookieOptions);
    redirect('/login?error=not_allowed');
  }

  // The session carries the local users.id, but re-resolving by email keeps
  // last_seen_at fresh and survives a row being recreated.
  const userId = await upsertUser(authed.email);
  return { userId, email: authed.email };
}

/**
 * Ensure a row exists in our local `users` table for this email. Idempotent.
 * Returns the local user id.
 *
 * Identity is keyed on email, which is what made the Supabase migration
 * survivable: the same Google account resolves to the same row, so foreign
 * keys from `reports` stayed intact with no identity remapping.
 */
export async function upsertUser(email: string): Promise<string> {
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

  // Guard against a race between the select and the insert.
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
