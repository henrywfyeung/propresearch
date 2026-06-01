// src/agents/nodes/13_render.ts — Node 13 (CLAUDE.md §7.15). State -> ReportData ->
// HTML -> PDF -> S3. Render/upload failures propagate (the report fails; retryable).

import type { GraphState } from '@/agents/annotation';
import { fetchImagesAsDataUrls } from '@/report/fetchImages';
import { renderReportPdf } from '@/report/pdf';
import { renderReportHtml } from '@/report/render';
import { toReportData } from '@/report/toReportData';
import { staticMapDataUrl } from '@/tools/mapbox/staticMap';
import { uploadPdf } from '@/tools/storage/s3';

export async function render(state: GraphState): Promise<Partial<GraphState>> {
  const data = toReportData(state);
  if (!data) {
    return {
      errors: [{ code: 'PARTIAL_DATA', message: 'render: missing resolvedAddress or subject' }],
    };
  }

  // Fetch the static location map. Failures degrade gracefully (null → no map in PDF).
  const addr = state.resolvedAddress;
  if (addr) {
    const selectedComps = state.comparables
      .filter(
        (c) =>
          (c.selection === 'fair-value' || c.selection === 'negotiation-anchor') &&
          c.lat != null &&
          c.lng != null,
      )
      .map((c) => ({ lat: c.lat as number, lng: c.lng as number }));

    data.staticMapDataUrl = await staticMapDataUrl({ lat: addr.lat, lng: addr.lng }, selectedComps);
  }

  // Download listing photos + floor plans as base64 data URLs so Puppeteer doesn't
  // need to make network requests at render time (CDN fetches were timing out before
  // networkidle0 fired, causing incomplete photo grids).
  data.photos = await fetchImagesAsDataUrls(state.subject?.photos ?? [], 6);
  data.floorplans = await fetchImagesAsDataUrls(state.subject?.floorplans ?? [], 2);

  const html = renderReportHtml(data);
  const pdf = await renderReportPdf(html);
  const key = await uploadPdf(`reports/${state.reportId}/v1.pdf`, pdf);
  return { pdfUrl: key };
}
