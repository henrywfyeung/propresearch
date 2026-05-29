// Per-report context via AsyncLocalStorage — CLAUDE.md §8.1 / [R16].
// Lets domainCall track per-report Domain quota and structuredCall track
// per-report LLM cost without threading reportId through every call site.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface ReportCtx {
  reportId: string;
  domainCalls: number;
  costUsd: number;
}

export const reportCtx = new AsyncLocalStorage<ReportCtx>();

/** Run `fn` with a fresh per-report context. */
export function runWithReportContext<T>(
  init: { reportId: string; domainCalls?: number; costUsd?: number },
  fn: () => Promise<T>,
): Promise<T> {
  return reportCtx.run(
    { reportId: init.reportId, domainCalls: init.domainCalls ?? 0, costUsd: init.costUsd ?? 0 },
    fn,
  );
}

/** Current context or undefined (e.g. when called outside a report run). */
export function getReportCtx(): ReportCtx | undefined {
  return reportCtx.getStore();
}
