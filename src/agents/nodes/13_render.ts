// src/agents/nodes/13_render.ts — Node 13 (CLAUDE.md §7.15). State -> ReportData ->
// HTML -> PDF -> S3. Render/upload failures propagate (the report fails; retryable).

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import { fetchImagesAsDataUrls } from '@/report/fetchImages';
import { selectedMapComps } from '@/report/mapComps';
import { EARLY_ED_STYLE, HOSPITAL_STYLE, schoolStyle } from '@/report/mapMarkers';
import { renderReportPdf } from '@/report/pdf';
import { renderReportHtml } from '@/report/render';
import { toReportData } from '@/report/toReportData';
import { staticMapDataUrl } from '@/tools/mapbox/staticMap';
import { uploadPdf } from '@/tools/storage/s3';
import { streetviewUrl } from '@/tools/streetview/url';

export async function render(state: GraphState): Promise<Partial<GraphState>> {
  const data = toReportData(state);
  if (!data) {
    return {
      errors: [{ code: 'PARTIAL_DATA', message: 'render: missing resolvedAddress or subject' }],
    };
  }

  // A valuation dossier with no valuation is not worth rendering — fail cleanly
  // (retryable) instead of shipping a hollow PDF. This happens when an upstream
  // LLM outage degrades Node 06 so far that no fair-value comp survives.
  if (!state.triangulation) {
    return {
      errors: [
        {
          code: 'PARTIAL_DATA',
          message: 'render: no valuation produced (triangulation null) — refusing to render',
        },
      ],
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

    // Category markers, distinct per type (primary green / secondary blue /
    // childcare amber / hospital red). state.schools is sorted nearest-first;
    // take the nearest few PER category so each type is represented but the map
    // stays readable.
    const used = new Map<string, number>();
    const schoolMarkers = (state.schools ?? []).flatMap((s) => {
      const st = schoolStyle(s.type);
      const cap = st === EARLY_ED_STYLE ? 2 : 3;
      const n = used.get(st.color) ?? 0;
      if (n >= cap) return [];
      used.set(st.color, n + 1);
      return [{ lat: s.lat, lng: s.lng, glyph: st.glyph, color: st.color }];
    });
    // Hospitals within 3km only (a far hospital would zoom the map right out).
    const hospitalMarkers = (state.hospitals ?? [])
      .filter((hp) => hp.distanceM <= 3000)
      .slice(0, 3)
      .map((hp) => ({
        lat: hp.lat,
        lng: hp.lng,
        glyph: HOSPITAL_STYLE.glyph,
        color: HOSPITAL_STYLE.color,
      }));

    data.staticMapDataUrl = await staticMapDataUrl({ lat: addr.lat, lng: addr.lng }, mapComps, [
      ...schoolMarkers,
      ...hospitalMarkers,
    ]);
  }

  // Download listing photos + floor plans as base64 data URLs so Puppeteer doesn't
  // need to make network requests at render time (CDN fetches were timing out before
  // networkidle0 fired, causing incomplete photo grids).
  data.photos = await fetchImagesAsDataUrls(state.subject?.photos ?? [], 6);
  data.floorplans = await fetchImagesAsDataUrls(state.subject?.floorplans ?? [], 2);

  // A few small thumbnails per selected comp — a visual hint in each comp card.
  // Request a smaller REA render size (480x320) so the PDF stays light.
  const selectedComps = state.comparables.filter(
    (c) => c.selection === 'fair-value' || c.selection === 'negotiation-anchor',
  );
  const compPhotoEntries = await Promise.all(
    selectedComps.map(async (c) => {
      const thumbs = (c.photos ?? []).slice(0, 3).map((u) => u.replace('1920x1080', '480x320'));
      return [c.id, await fetchImagesAsDataUrls(thumbs, 3)] as const;
    }),
  );
  data.compPhotos = Object.fromEntries(compPhotoEntries.filter(([, urls]) => urls.length > 0));

  // Street View hero image — one kerb-side heading, as a visual hint beneath the
  // street-level assessment. Only when 04c produced an assessment (⇒ imagery
  // exists) and a key is configured; degrades to null otherwise.
  if (data.streetView && addr && process.env.GOOGLE_MAPS_KEY) {
    const [hero] = await fetchImagesAsDataUrls([streetviewUrl(addr.lat, addr.lng, 0)], 1);
    data.streetViewImageDataUrl = hero ?? null;
  }

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
