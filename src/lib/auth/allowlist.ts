// Allow-list checks (CLAUDE.md §10.2 / §10.3, [R5]).
//
// `isAllowed` is the raw DB lookup (Drizzle, Node runtime only).
// `isAllowedCached` wraps it in a 60-second in-memory TTL cache so the
// per-request re-check doesn't hammer Postgres. The cache is per-process;
// on Vercel that means revocation propagates within 60s per warm instance
// (documented in CLAUDE.md §10.3).

import { db } from '@/db/client';
import { allowedEmails } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function isAllowed(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const rows = await db
    .select({ email: allowedEmails.email })
    .from(allowedEmails)
    .where(eq(allowedEmails.email, normalized))
    .limit(1);
  return rows.length > 0;
}

const TTL_MS = 60_000;
const cache = new Map<string, { allowed: boolean; expires: number }>();

export async function isAllowedCached(email: string): Promise<boolean> {
  const key = email.trim().toLowerCase();
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) {
    return hit.allowed;
  }
  const allowed = await isAllowed(key);
  cache.set(key, { allowed, expires: now + TTL_MS });
  return allowed;
}

/** Test/admin hook — drops a cached entry so a revocation can take effect now. */
export function clearAllowlistCache(email?: string): void {
  if (email) {
    cache.delete(email.trim().toLowerCase());
  } else {
    cache.clear();
  }
}
