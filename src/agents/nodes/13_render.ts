// src/agents/nodes/13_render.ts — Node 13 (CLAUDE.md §7.15). State -> ReportData ->
// HTML -> PDF -> S3. Render/upload failures propagate (the report fails; retryable).

import type { GraphState } from '@/agents/annotation';
import { renderReportPdf } from '@/report/pdf';
import { renderReportHtml } from '@/report/render';
import { toReportData } from '@/report/toReportData';
import { uploadPdf } from '@/tools/storage/s3';

export async function render(state: GraphState): Promise<Partial<GraphState>> {
  const data = toReportData(state);
  if (!data) {
    return {
      errors: [{ code: 'PARTIAL_DATA', message: 'render: missing resolvedAddress or subject' }],
    };
  }
  const html = renderReportHtml(data);
  const pdf = await renderReportPdf(html);
  const key = await uploadPdf(`reports/${state.reportId}/v1.pdf`, pdf);
  return { pdfUrl: key };
}
