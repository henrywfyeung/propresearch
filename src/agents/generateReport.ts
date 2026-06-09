// src/agents/generateReport.ts — orchestrate one report: create the row, run the
// graph, persist the outcome. The body of the Inngest function.

import { runGraph } from '@/agents/graph';
import { buildSubject } from '@/agents/subject';
import { createReport, markFailed, markNode, markRunning, markSucceeded } from '@/db/reports';
import { logger } from '@/lib/observability/logger';

export interface GenerateReportInput {
  userId: string;
  rawAddress: string;
  rawSubject: unknown; // validated by buildSubject
}

export interface RunReportInput {
  rawAddress: string;
  rawSubject: unknown; // validated by buildSubject
}

/**
 * Run an already-created report row through the graph, writing per-node
 * progress to `reports.currentNode` as each node completes.  Called by the
 * Inngest function after it has received the event and resolved `reportId`.
 */
export async function runReport(reportId: string, input: RunReportInput): Promise<void> {
  await markRunning(reportId);
  try {
    const subject = buildSubject(input.rawSubject);
    const state = await runGraph(
      { reportId, rawAddress: input.rawAddress, subject },
      { onNode: (n) => markNode(reportId, n) },
    );
    if (!state.pdfUrl) {
      await markFailed(reportId, 'render produced no PDF');
      return;
    }
    await markSucceeded(reportId, {
      pdfUrl: state.pdfUrl,
      subjectAddress: state.resolvedAddress?.normalizedAddress ?? null,
    });
  } catch (err) {
    logger.error({ err, reportId }, 'runReport failed');
    await markFailed(reportId, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Convenience wrapper used by scripts / tests: create the report row, then
 * run it.  Inngest functions call `createReport` + `runReport` directly.
 */
export async function generateReport(input: GenerateReportInput): Promise<string> {
  const reportId = await createReport(input.userId);
  await runReport(reportId, { rawAddress: input.rawAddress, rawSubject: input.rawSubject });
  return reportId;
}
