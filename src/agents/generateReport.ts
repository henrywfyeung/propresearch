// src/agents/generateReport.ts — orchestrate one report: create the row, run the
// graph, persist the outcome. The body of the future Inngest function.

import { runGraph } from '@/agents/graph';
import { buildSubject } from '@/agents/subject';
import { createReport, markFailed, markRunning, markSucceeded } from '@/db/reports';
import { logger } from '@/lib/observability/logger';

export interface GenerateReportInput {
  userId: string;
  rawAddress: string;
  rawSubject: unknown; // validated by buildSubject
}

export async function generateReport(input: GenerateReportInput): Promise<string> {
  const reportId = await createReport(input.userId);
  await markRunning(reportId);
  try {
    const subject = buildSubject(input.rawSubject);
    const state = await runGraph({ reportId, rawAddress: input.rawAddress, subject });
    if (!state.pdfUrl) {
      await markFailed(reportId, 'render produced no PDF');
      return reportId;
    }
    await markSucceeded(reportId, {
      pdfUrl: state.pdfUrl,
      subjectAddress: state.resolvedAddress?.normalizedAddress ?? null,
    });
  } catch (err) {
    logger.error({ err, reportId }, 'generateReport failed');
    await markFailed(reportId, err instanceof Error ? err.message : String(err));
  }
  return reportId;
}
