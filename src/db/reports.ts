// src/db/reports.ts — report row lifecycle (CLAUDE.md §4.2). Runs in the worker
// context (alongside the graph + llm_calls writes), so it uses the session-mode
// workerDb pool.
//
// getReportStatus uses the transaction-mode `db` pool because it is called
// from the Next.js Node runtime (not the Inngest worker) — see [R17].

import { db } from '@/db/client';
import { workerDb } from '@/db/client-worker';
import { reports } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

export async function createReport(userId: string): Promise<string> {
  const [row] = await workerDb
    .insert(reports)
    .values({ userId, status: 'queued' })
    .returning({ id: reports.id });
  if (!row) throw new Error('createReport: insert returned no row');
  return row.id;
}

export async function markRunning(id: string): Promise<void> {
  await workerDb
    .update(reports)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(reports.id, id));
}

export interface ReportSuccess {
  pdfUrl: string;
  subjectAddress: string | null;
}

export async function markSucceeded(id: string, r: ReportSuccess): Promise<void> {
  await workerDb
    .update(reports)
    .set({
      status: 'succeeded',
      pdfUrl: r.pdfUrl,
      subjectAddress: r.subjectAddress,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reports.id, id));
}

export async function markFailed(id: string, errorMessage: string): Promise<void> {
  await workerDb
    .update(reports)
    .set({ status: 'failed', errorMessage, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(reports.id, id));
}

export async function markNode(id: string, currentNode: string): Promise<void> {
  await workerDb
    .update(reports)
    .set({ currentNode, updatedAt: new Date() })
    .where(eq(reports.id, id));
}

// ---------------------------------------------------------------------------
// Status fetch — used by GET /api/reports/[id].
//
// Selects only the top-level denormalised columns (status, currentNode,
// pdfUrl, errorMessage, subjectAddress). The by-id + by-userId predicate
// satisfies the §4.3 cross-row ESLint guard and doubles as an ownership
// check — callers receive null whether the row doesn't exist or belongs to
// a different user (no information leak).
// ---------------------------------------------------------------------------

export interface ReportStatusRow {
  status: string;
  currentNode: string | null;
  pdfUrl: string | null;
  errorMessage: string | null;
  subjectAddress: string | null;
}

/**
 * Returns the status columns for the given report if it belongs to userId,
 * or null otherwise.
 */
export async function getReportStatus(id: string, userId: string): Promise<ReportStatusRow | null> {
  const [row] = await db
    .select({
      status: reports.status,
      currentNode: reports.currentNode,
      pdfUrl: reports.pdfUrl,
      errorMessage: reports.errorMessage,
      subjectAddress: reports.subjectAddress,
    })
    .from(reports)
    .where(and(eq(reports.id, id), eq(reports.userId, userId)))
    .limit(1);

  return row ?? null;
}
