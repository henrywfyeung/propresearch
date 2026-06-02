// src/agents/nodes/13_render.ts — Node 13 (CLAUDE.md §7.15). State -> ReportData ->
// HTML -> PDF -> S3. Render/upload failures propagate (the report fails; retryable).

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import { fetchImagesAsDataUrls } from '@/report/fetchImages';
import { selectedMapComps } from '@/report/mapComps';
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
    // Number the pins 1..N in the same order ReportDocument numbers the legend
    // (both use selectedMapComps) so pin "3" === legend row "3".
    const mapComps = selectedMapComps(state.comparables).map((c, i) => ({
      lat: c.lat as number,
      lng: c.lng as number,
      label: String(i + 1),
    }));

    // Nearest schools (green) + hospitals (red) as markers (both sorted
    // nearest-first; staticMap caps each).
    const schoolMarkers = (state.schools ?? []).map((s) => ({ lat: s.lat, lng: s.lng }));
    const hospitalMarkers = (state.hospitals ?? []).map((hp) => ({ lat: hp.lat, lng: hp.lng }));

    data.staticMapDataUrl = await staticMapDataUrl(
      { lat: addr.lat, lng: addr.lng },
      mapComps,
      schoolMarkers,
      hospitalMarkers,
    );
  }

  // Download listing photos + floor plans as base64 data URLs so Puppeteer doesn't
  // need to make network requests at render time (CDN fetches were timing out before
  // networkidle0 fired, causing incomplete photo grids).
  data.photos = await fetchImagesAsDataUrls(state.subject?.photos ?? [], 6);
  data.floorplans = await fetchImagesAsDataUrls(state.subject?.floorplans ?? [], 2);

  // Diagnostic: how many photos arrived in state vs how many actually embedded.
  // A gap (state has N, embedded < N) points at render-time CDN download failures;
  // state itself being short points upstream (Node 04a fetch / fan-out).
  logger.info(
    {
      reportId: state.reportId,
      statePhotos: state.subject?.photos?.length ?? 0,
      stateFloorplans: state.subject?.floorplans?.length ?? 0,
      embeddedPhotos: data.photos.length,
      embeddedFloorplans: data.floorplans.length,
    },
    'render: image embedding counts',
  );

  const html = renderReportHtml(data);
  const pdf = await renderReportPdf(html);
  const key = await uploadPdf(`reports/${state.reportId}/v1.pdf`, pdf);
  return { pdfUrl: key };
}
