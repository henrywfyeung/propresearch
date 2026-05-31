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

const SUBJECT = {
  attrs: { beds: 4, baths: 2, parking: 2, landArea: 600, buildingArea: null, propertyType: 'House' },
  photos: [] as string[],
};

async function main() {
  const address = process.argv[2] ?? '12 Awaba Street, Mosman NSW 2088';
  console.log(`LIVE end-to-end run for: ${address}\n`);

  const { reportGraph } = await import('@/agents/graph');
  const { buildSubject } = await import('@/agents/subject');
  const { renderClaim } = await import('@/report/renderClaim');

  const subject = buildSubject(SUBJECT);
  const t0 = Date.now();
  const state = await reportGraph.invoke({ reportId: randomUUID(), rawAddress: address, subject });
  console.log(`(graph completed in ${Math.round((Date.now() - t0) / 1000)}s)\n`);

  console.log('=== resolved ===');
  console.log(state.resolvedAddress);
  const fv = state.comparables.filter((c) => c.selection === 'fair-value');
  const an = state.comparables.filter((c) => c.selection === 'negotiation-anchor');
  console.log(`\n=== comps === ${state.comparables.length} candidates | ${fv.length} fair-value | ${an.length} anchor`);
  console.log('\n=== value ===');
  console.log(state.triangulation);
  console.log('\n=== PROSE ===');
  for (const [section, blocks] of Object.entries(state.prose ?? {})) {
    console.log(`\n## ${section}`);
    for (const b of blocks ?? []) console.log(`  ${renderClaim(b)}`);
  }
  console.log('\n=== pdfUrl ===', state.pdfUrl);
  if (state.errors.length) console.log('\n=== errors ===', state.errors);
}

// process.exit so the open workerDb pool (and any Puppeteer handle) doesn't keep
// the event loop alive after the run finishes.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nFATAL:', e instanceof Error ? e.stack : e);
    process.exit(1);
  });
