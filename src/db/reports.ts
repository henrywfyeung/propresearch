// src/db/reports.ts — report row lifecycle (CLAUDE.md §4.2).
//
// Single `db` client throughout. The old transaction-mode/session-mode split
// ([R17]) existed only to satisfy Supabase's Supavisor pooler; Cloud SQL has
// one connection mode, so route handlers and the Inngest worker share it.

import { db } from '@/db/client';
import { reports } from '@/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export async function createReport(userId: string): Promise<string> {
  const [row] = await db
    .insert(reports)
    .values({ userId, status: 'queued' })
    .returning({ id: reports.id });
  if (!row) throw new Error('createReport: insert returned no row');
  return row.id;
}

export async function markRunning(id: string): Promise<void> {
  await db
    .update(reports)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(reports.id, id));
}

export interface ReportSuccess {
  pdfUrl: string;
  subjectAddress: string | null;
}

export async function markSucceeded(id: string, r: ReportSuccess): Promise<void> {
  await db
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
  await db
    .update(reports)
    .set({ status: 'failed', errorMessage, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(reports.id, id));
}

export async function markNode(id: string, currentNode: string): Promise<void> {
  await db
    .update(reports)
    .set({ currentNode, updatedAt: new Date() })
    .where(eq(reports.id, id));
}

// ---------------------------------------------------------------------------
// Dashboard list — used by the dashboard page (GET /).
//
// Returns the user's own reports (newest first) selecting only top-level
// denormalised columns so the §4.3 cross-row ESLint guard is satisfied.
// ---------------------------------------------------------------------------

export interface ReportListRow {
  id: string;
  subjectAddress: string | null;
  status: string;
  createdAt: Date;
}

/**
 * Returns all reports belonging to userId, newest first.
 * Selects top-level columns only (id, subjectAddress, status, createdAt).
 */
export async function listReportsForUser(userId: string): Promise<ReportListRow[]> {
  return db
    .select({
      id: reports.id,
      subjectAddress: reports.subjectAddress,
      status: reports.status,
      createdAt: reports.createdAt,
    })
    .from(reports)
    .where(eq(reports.userId, userId))
    .orderBy(desc(reports.createdAt));
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
