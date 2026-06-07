// scripts/run-report-live.ts — REAL end-to-end run: live Mapbox + REA + OpenAI +
// Puppeteer render + S3 upload. Loads .env.local BEFORE importing app modules
// (the worker DB client reads its URL at import time), then invokes the compiled
// graph directly (no per-report context → llm_calls.reportId is null, which is
// fine for a one-off validation run).
//
// Usage: CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//          pnpm tsx scripts/run-report-live.ts ["12 Awaba Street, Mosman NSW 2088"]

import { randomUUID } from 'node:crypto';
import process from 'node:process';

process.loadEnvFile('.env.local');

// Subject attrs are overridable via env (BEDS/BATHS/PARKING/LAND_AREA/PROPERTY_TYPE)
// so the demo can match a real currently-listed property. Node 04a now AUTO-fetches
// the listing's photos + floor plan from REA; PHOTOS env adds optional extras (R55).
const numEnv = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const SUBJECT = {
  attrs: {
    beds: numEnv(process.env.BEDS, 4),
    baths: numEnv(process.env.BATHS, 2),
    parking: numEnv(process.env.PARKING, 2),
    landArea: process.env.LAND_AREA ? Number(process.env.LAND_AREA) : null,
    buildingArea: null,
    propertyType: process.env.PROPERTY_TYPE ?? 'House',
  },
  photos: (process.env.PHOTOS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

async function main() {
  const address = process.argv[2] ?? '12 Awaba Street, Mosman NSW 2088';
  console.log(`LIVE end-to-end run for: ${address}\n`);

  const { reportGraph } = await import('@/agents/graph');
  const { buildSubject } = await import('@/agents/subject');
  const { renderClaim } = await import('@/report/renderClaim');
  const { collectCalls, summarizeCalls, formatCostTable } = await import('@/tools/llm/costSink');

  const subject = buildSubject(SUBJECT);
  // Caller-owned so the cost breakdown still prints if the graph throws mid-run
  // (e.g. a stalled reasoning node) — the `finally` reads what was spent.
  const records: import('@/tools/llm/costSink').LlmCallRecord[] = [];
  const t0 = Date.now();

  try {
    const state = await collectCalls(records, () =>
      reportGraph.invoke({ reportId: randomUUID(), rawAddress: address, subject }),
    );
    console.log(`(graph completed in ${Math.round((Date.now() - t0) / 1000)}s)\n`);

    console.log('=== resolved ===');
    console.log(state.resolvedAddress);
    const fv = state.comparables.filter((c) => c.selection === 'fair-value');
    const an = state.comparables.filter((c) => c.selection === 'negotiation-anchor');
    console.log(`\n=== comps === ${state.comparables.length} candidates | ${fv.length} fair-value | ${an.length} anchor`);
    console.log('\n=== value ===');
    console.log(state.triangulation);
    console.log('\n=== risks ===');
    for (const r of state.risks ?? [])
      console.log(`  ${r.category.padEnd(9)} ${r.severity.padEnd(13)}${r.dataAvailable ? '' : ' [unavailable]'} — ${r.description}`);
    console.log('\n=== suburb market ===');
    const d = state.demographics;
    if (d)
      console.log(`  ${d.sa2Name}: pop ${d.population}, median age ${d.medianAge}, hh income $${d.medianHouseholdIncomeWeekly}/wk, ${d.ownerOccupiedPct}% owner-occupied`);
    console.log(`  recent DAs ≤500m: ${state.market?.recentDAs?.length ?? 0}`);
    console.log('\n=== PROSE ===');
    for (const [section, blocks] of Object.entries(state.prose ?? {})) {
      console.log(`\n## ${section}`);
      for (const b of blocks ?? []) console.log(`  ${renderClaim(b)}`);
    }
    console.log('\n=== pdfUrl ===', state.pdfUrl);
    if (state.errors.length) console.log('\n=== errors ===', state.errors);

    // Optional: re-render the live state to a local PNG/PDF for visual review
    // (SAVE_REPORT_PNG=/tmp/foo → /tmp/foo.png + /tmp/foo.pdf).
    const out = process.env.SAVE_REPORT_PNG;
    if (out) {
      try {
        const { toReportData } = await import('@/report/toReportData');
        const { fetchImagesAsDataUrls } = await import('@/report/fetchImages');
        const { renderReportHtml } = await import('@/report/render');
        const { staticMapDataUrl } = await import('@/tools/mapbox/staticMap');
        const { selectedMapComps } = await import('@/report/mapComps');
        const { EARLY_ED_STYLE, HOSPITAL_STYLE, schoolStyle } = await import('@/report/mapMarkers');
        const puppeteer = (await import('puppeteer-core')).default;
        const { writeFileSync } = await import('node:fs');
        const data = toReportData(state);
        if (data) {
          const a = state.resolvedAddress;
          if (a) {
            const mapComps = selectedMapComps(state.comparables).map((c, i) => ({
              lat: c.lat as number,
              lng: c.lng as number,
              label: String(i + 1),
            }));
            // Mirror Node 13: distinct school + hospital category markers.
            const used = new Map<string, number>();
            const schoolMarkers = (state.schools ?? []).flatMap((s) => {
              const st = schoolStyle(s.type);
              const cap = st === EARLY_ED_STYLE ? 2 : 3;
              const n = used.get(st.color) ?? 0;
              if (n >= cap) return [];
              used.set(st.color, n + 1);
              return [{ lat: s.lat, lng: s.lng, glyph: st.glyph, color: st.color }];
            });
            const hospitalMarkers = (state.hospitals ?? [])
              .filter((hp) => hp.distanceM <= 3000)
              .slice(0, 3)
              .map((hp) => ({
                lat: hp.lat,
                lng: hp.lng,
                glyph: HOSPITAL_STYLE.glyph,
                color: HOSPITAL_STYLE.color,
              }));
            data.staticMapDataUrl = await staticMapDataUrl({ lat: a.lat, lng: a.lng }, mapComps, [
              ...schoolMarkers,
              ...hospitalMarkers,
            ]).catch(() => null);
          }
          data.photos = await fetchImagesAsDataUrls(state.subject?.photos ?? [], 6);
          data.floorplans = await fetchImagesAsDataUrls(state.subject?.floorplans ?? [], 2);
          // Per-comp thumbnails (mirror Node 13).
          const selectedComps = state.comparables.filter(
            (c) => c.selection === 'fair-value' || c.selection === 'negotiation-anchor',
          );
          const compPhotoEntries = await Promise.all(
            selectedComps.map(async (c) => {
              const thumbs = (c.photos ?? []).slice(0, 3).map((u) => u.replace('1920x1080', '480x320'));
              return [c.id, await fetchImagesAsDataUrls(thumbs, 3)] as const;
            }),
          );
          data.compPhotos = Object.fromEntries(compPhotoEntries.filter(([, u]) => u.length > 0));
          // Street View hero image (mirror Node 13).
          if (data.streetView && a && process.env.GOOGLE_MAPS_KEY) {
            const { streetviewUrl } = await import('@/tools/streetview/url');
            const [hero] = await fetchImagesAsDataUrls([streetviewUrl(a.lat, a.lng, 0)], 1);
            data.streetViewImageDataUrl = hero ?? null;
          }
          const html = renderReportHtml(data);
          const browser = await puppeteer.launch({
            executablePath: process.env.CHROME_PATH,
            headless: true,
            args: ['--no-sandbox'],
          });
          const page = await browser.newPage();
          await page.setContent(html, { waitUntil: 'networkidle0' });
          writeFileSync(
            `${out}.pdf`,
            await page.pdf({
              format: 'A4',
              printBackground: true,
              margin: { top: '15mm', right: '15mm', bottom: '20mm', left: '15mm' },
            }),
          );
          await page.setViewport({ width: 880, height: 1245, deviceScaleFactor: 2 });
          writeFileSync(`${out}.png`, await page.screenshot({ fullPage: true }));
          await browser.close();
          console.log(`\n=== local render -> ${out}.png / ${out}.pdf ===`);
        }
      } catch (e) {
        console.log('local render failed:', e instanceof Error ? e.message : e);
      }
    }
  } finally {
    console.log(`\n=== COST BREAKDOWN (recorded LLM calls, ${Math.round((Date.now() - t0) / 1000)}s) ===`);
    console.log(formatCostTable(summarizeCalls(records)));
    console.log(
      '\nNote: only SUCCESSFUL LLM calls are recorded. Abandoned gpt-5.4 reasoning\n' +
        'attempts (stalls/timeouts) are NOT counted here, though OpenAI may still bill\n' +
        'for them. Deterministic nodes (resolveAddress, fetch*, triangulate, render)\n' +
        'make no LLM calls and cost $0. Prices are the estimates in src/tools/llm/costs.ts.',
    );
  }
}

// process.exit so the open workerDb pool (and any Puppeteer handle) doesn't keep
// the event loop alive after the run finishes.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nFATAL:', e instanceof Error ? e.stack : e);
    process.exit(1);
  });
