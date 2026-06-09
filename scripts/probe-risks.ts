// scripts/probe-risks.ts — validate the LIVE NSW risk register (Node 09 fetchRisks
// → real ArcGIS calls: LGA + bushfire + heritage + flood). No LLM, no render — just
// the risk adapters end-to-end against the live keyless NSW DCCEEW host.
//
// Usage: pnpm tsx scripts/probe-risks.ts

import process from 'node:process';

process.loadEnvFile('.env.local');

const POINTS: Array<{ label: string; lat: number; lng: number; expect: string }> = [
  { label: 'Mosman (subject)', lat: -33.822065, lng: 151.249272, expect: 'bushfire/heritage none; flood data-unavailable (uncovered LGA)' },
  { label: 'Blue Mountains (Katoomba)', lat: -33.72706, lng: 150.29763, expect: 'bushfire flag' },
  { label: 'Potts Point (heritage)', lat: -33.871157, lng: 151.224516, expect: 'heritage flag (SHR/LEP)' },
  { label: 'Clarence Valley (Grafton floodplain)', lat: -29.863214, lng: 153.264577, expect: 'flood flag (covered LGA)' },
];

async function main() {
  const { fetchRisks } = await import('@/agents/nodes/09_fetchRisks');

  for (const p of POINTS) {
    const state = {
      resolvedAddress: {
        lat: p.lat,
        lng: p.lng,
        state: 'NSW',
        suburb: p.label,
        postcode: '0000',
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
