// scripts/probe-vic-risks.ts — validate the LIVE VIC risk register (Node 09 VIC
// branch → real Vicmap GeoServer WFS: flood/bushfire/heritage). No LLM, no render.
// Usage: pnpm tsx scripts/probe-vic-risks.ts

import process from 'node:process';

process.loadEnvFile('.env.local');

const POINTS: Array<{ label: string; lat: number; lng: number; expect: string }> = [
  { label: 'Maribyrnong (flood)', lat: -37.7965, lng: 144.9125, expect: 'flood (LSIO)' },
  { label: 'Dandenong Ranges (bushfire)', lat: -37.88, lng: 145.35, expect: 'bushfire (BMO/BPA)' },
  { label: 'Fitzroy (heritage)', lat: -37.798, lng: 144.978, expect: 'heritage (HO)' },
  { label: 'Royal Exhibition Bldg (VHR)', lat: -37.8042, lng: 144.9715, expect: 'heritage (VHR, high)' },
  { label: 'Melbourne CBD', lat: -37.8136, lng: 144.9631, expect: 'mostly none' },
];

async function main() {
  const { fetchRisks } = await import('@/agents/nodes/09_fetchRisks');

  for (const p of POINTS) {
    const state = {
      resolvedAddress: {
        lat: p.lat,
        lng: p.lng,
        state: 'VIC',
        suburb: p.label,
        postcode: '3000',
        normalizedAddress: p.label,
      },
      risks: [],
      errors: [],
      // biome-ignore lint/suspicious/noExplicitAny: minimal GraphState for a probe
    } as any;
    const t0 = Date.now();
    const out = await fetchRisks(state);
    console.log(`\n=== ${p.label} (${((Date.now() - t0) / 1000).toFixed(1)}s) — expect: ${p.expect}`);
    for (const r of out.risks ?? []) {
      const avail = r.dataAvailable ? '' : ' [DATA UNAVAILABLE]';
      console.log(`  ${r.category.padEnd(9)} ${r.severity.padEnd(13)}${avail} — ${r.description}`);
    }
    if (out.errors?.length) console.log('  errors:', out.errors);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL:', e instanceof Error ? e.stack : e);
    process.exit(1);
  });
