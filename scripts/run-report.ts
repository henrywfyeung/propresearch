// scripts/run-report.ts — run the WHOLE graph end-to-end on a real address and
// print the value range + rendered prose. Needs (in .env.local): MAPBOX_TOKEN,
// RAPIDAPI_KEY, OPENAI_API_KEY, OPENAI_MODEL_REASONING, OPENAI_MODEL_COMPOSE
// (+ ANTHROPIC_API_KEY/ANTHROPIC_MODEL_FALLBACK for the fallback path), and a
// reachable Postgres (DATABASE_URL/WORKER_DATABASE_URL) for the llm_calls ledger.
//
// Usage: pnpm tsx scripts/run-report.ts "12 Awaba Street, Mosman NSW 2088"
// Edit `SAMPLE_SUBJECT` below to match the property you're researching.

import process from 'node:process';
import { runGraph } from '@/agents/graph';
import { buildSubject } from '@/agents/subject';
import { renderClaim } from '@/report/renderClaim';

// Load .env.local so this is a one-command runner (Node 20.12+/24 native).
try {
  process.loadEnvFile('.env.local');
} catch {
  // env may already be set in the shell; carry on.
}

const SAMPLE_SUBJECT = {
  attrs: {
    beds: 4,
    baths: 2,
    parking: 2,
    landArea: 600,
    buildingArea: null,
    propertyType: 'House',
  },
  photos: [] as string[],
};

async function main() {
  const address = process.argv[2] ?? '12 Awaba Street, Mosman NSW 2088';
  console.log(`Generating report for: ${address}\n`);

  const subject = buildSubject(SAMPLE_SUBJECT);
  const state = await runGraph({ reportId: 'run-report', rawAddress: address, subject });

  console.log('=== Resolved address ===');
  console.log(state.resolvedAddress);

  const fairValue = state.comparables.filter((c) => c.selection === 'fair-value').length;
  console.log(
    `\n=== Comparables === ${state.comparables.length} candidates, ${fairValue} fair-value`,
  );

  console.log('\n=== Value ===');
  console.log(state.triangulation);

  console.log('\n=== Report prose ===');
  for (const [section, blocks] of Object.entries(state.prose ?? {})) {
    console.log(`\n## ${section}`);
    for (const block of blocks ?? []) console.log(renderClaim(block));
  }

  if (state.errors.length > 0) console.log('\n=== Degradations / errors ===', state.errors);
}

main().catch((e) => {
  console.error('\nFATAL:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
