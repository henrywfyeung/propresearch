// scripts/probe-planning.ts — validate the LIVE planning section (Node 05
// fetchPlanning → resolveLga + NSW Online DA API + client-side ≤500m haversine).
// No LLM, no render. Usage: pnpm tsx scripts/probe-planning.ts

import process from 'node:process';

process.loadEnvFile('.env.local');

const POINTS = [
  { label: 'Mosman (subject)', lat: -33.822065, lng: 151.249272 }, // expect ~36 DAs ≤500m
  { label: 'Sydney CBD', lat: -33.8708, lng: 151.2073 }, // expect many
];

async function main() {
  const { fetchPlanning } = await import('@/agents/nodes/05_planningAndNews');

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
      market: null,
      errors: [],
      // biome-ignore lint/suspicious/noExplicitAny: minimal GraphState for a probe
    } as any;
    const t0 = Date.now();
    const out = await fetchPlanning(state);
    const das = out.market?.recentDAs ?? [];
    console.log(`\n=== ${p.label} (${((Date.now() - t0) / 1000).toFixed(1)}s) — ${das.length} DAs ≤500m`);
    for (const d of das.slice(0, 6)) {
      console.log(`  ${String(Math.round(d.distanceM)).padStart(4)}m · ${d.lodgedDate ?? '—'} · ${(d.status ?? '—').padEnd(16)} · ${d.description.slice(0, 64)}`);
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
