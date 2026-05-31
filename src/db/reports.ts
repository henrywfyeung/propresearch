// src/db/reports.ts — report row lifecycle (CLAUDE.md §4.2). Runs in the worker
// context (alongside the graph + llm_calls writes), so it uses the session-mode
// workerDb pool.

import { workerDb } from '@/db/client-worker';
import { reports } from '@/db/schema';
import { eq } from 'drizzle-orm';

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
