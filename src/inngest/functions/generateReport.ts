// src/inngest/functions/generateReport.ts — durable Inngest function that runs
// a report generation job in response to a `reports/generate.requested` event.

import { runReport } from '@/agents/generateReport';
import { inngest } from '@/inngest/client';

/**
 * The bare handler logic, exported so unit tests can invoke it directly without
 * having to unpick the opaque object returned by `createFunction`.
 */
export async function runReportHandler({
  event,
  step,
}: {
  event: { data: { reportId: string; userId: string; rawAddress: string; rawSubject: unknown } };
  step: { run: <T>(id: string, fn: () => Promise<T> | T) => Promise<T> };
}): Promise<{ reportId: string }> {
  await step.run('run-report', () =>
    runReport(event.data.reportId, {
      rawAddress: event.data.rawAddress,
      rawSubject: event.data.rawSubject,
    }),
  );
  return { reportId: event.data.reportId };
}

/**
 * Inngest function: `reports/generate`.
 *
 * Concurrency caps (CLAUDE.md §12):
 *   - 4 concurrent runs globally
 *   - 2 concurrent runs per user
 *
 * Retries: 1 (Inngest retries once on failure before marking the run failed).
 *
 * v1 is a single step — the full pipeline runs inside one Vercel Pro invocation
 * (≤300 s).  The 6-step graphSlice + checkpointer split described in CLAUDE.md
 * §12 / §6.4 is the documented follow-up for when run times exceed ~250 s.
 */
export const generateReportFn = inngest.createFunction(
  {
    id: 'reports/generate',
    retries: 1,
    concurrency: [
      { scope: 'fn', limit: 4 },
      { scope: 'fn', key: 'event.data.userId', limit: 2 },
    ],
  },
  { event: 'reports/generate.requested' },
  runReportHandler,
);
