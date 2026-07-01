// src/db/rate-limit.ts — per-user daily report cap (CLAUDE.md §11.1).
//
// Runs in the Next.js Node runtime (POST /api/reports), so it uses the
// transaction-mode `db` pool.
//
// Increment-on-REQUEST (not only on success): every triggered report spends LLM
// budget whether or not it finishes, so to protect cost on the shared OpenAI key
// the cap must bound *triggers*. The limit is generous (20/day) so a legit user
// won't hit it; it exists to stop a stuck browser tab or a bad actor from
// running up spend on the live URL.

import { db } from '@/db/client';
import { rateLimitCounters } from '@/db/schema';
import { sql } from 'drizzle-orm';

export const DAILY_REPORT_LIMIT = Number(process.env.DAILY_REPORT_LIMIT) || 20;

/** Current calendar day in Sydney time — matches the schema's `YYYY-MM-DD` (AEST/AEDT). */
function sydneyDay(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Atomically increment today's report counter for the user and return the new
 * count. The caller rejects when `count > DAILY_REPORT_LIMIT`. Atomic upsert so
 * concurrent requests can't both slip under the cap.
 */
export async function bumpDailyReportCount(userId: string): Promise<number> {
  const day = sydneyDay();
  const [row] = await db
    .insert(rateLimitCounters)
    .values({ userId, day, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitCounters.userId, rateLimitCounters.day],
      set: { count: sql`${rateLimitCounters.count} + 1`, updatedAt: sql`now()` },
    })
    .returning({ count: rateLimitCounters.count });
  return row?.count ?? 1;
}
