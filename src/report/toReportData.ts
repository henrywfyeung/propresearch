// src/report/toReportData.ts — map graph state into the report template's ReportData.

import type { GraphState } from '@/agents/annotation';
import type { ReportData } from '@/report/template/ReportDocument';

export function toReportData(state: GraphState): ReportData | null {
  const a = state.resolvedAddress;
  const subject = state.subject;
  if (!a || !subject) return null;

  const t = state.triangulation;
  return {
    address: a.normalizedAddress,
    suburb: a.suburb,
    state: a.state,
    postcode: a.postcode,
    subject: subject.attrs,
    triangulation: t
      ? {
          low: t.low,
          high: t.high,
          reconciled: t.reconciled,
          confidence: t.confidence,
          uncertaintyNote: t.uncertaintyNote,
        }
      : null,
    comparables: state.comparables,
    risks: state.risks ?? [],
    recentDAs: state.market?.recentDAs ?? [],
    prose: state.prose,
    generatedAt: new Date().toISOString(),
  };
}
