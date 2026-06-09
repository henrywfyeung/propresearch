// scripts/probe-demographics.ts — validate the LIVE ABS demographics path (Node 12
// fetchDemographics → ABS ASGS SA2 lookup + ABS Data API + Census ArcGIS). No LLM.
// Usage: pnpm tsx scripts/probe-demographics.ts

import process from 'node:process';

process.loadEnvFile('.env.local');

const POINTS = [
  { label: 'Mosman NSW', lat: -33.822065, lng: 151.249272 },
  { label: 'Richmond VIC', lat: -37.815, lng: 144.999 },
];

async function main() {
  const { fetchDemographics } = await import('@/agents/nodes/12_fetchDemographics');

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
      demographics: null,
      errors: [],
      // biome-ignore lint/suspicious/noExplicitAny: minimal GraphState for a probe
    } as any;
    const t0 = Date.now();
    const out = await fetchDemographics(state);
    const d = out.demographics;
    console.log(`\n=== ${p.label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    if (!d) {
      console.log('  demographics: null');
    } else {
      console.log(`  SA2: ${d.sa2Code} "${d.sa2Name}"`);
      console.log(`  population=${d.population} medianAge=${d.medianAge} hhIncome/wk=$${d.medianHouseholdIncomeWeekly}`);
      console.log(`  rent/wk=$${d.medianRentWeekly} mortgage/mo=$${d.medianMortgageMonthly} hhSize=${d.avgHouseholdSize}`);
      console.log(`  ownerOccupied=${d.ownerOccupiedPct}% rented=${d.rentedPct}%`);
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
