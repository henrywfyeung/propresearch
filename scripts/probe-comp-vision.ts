// scripts/probe-comp-vision.ts — validate Node 04b (comp vision) on REAL comp
// photos, cheaply (a handful of comps, not a full report). Confirms (a) the
// youtube/video-host filter in photoUrls leaves clean REA image URLs, and
// (b) gpt-5.4 vision returns sensible condition + light layout per comp.
//
// Usage: pnpm tsx scripts/probe-comp-vision.ts ["Mosman NSW 2088"]

import process from 'node:process';

process.loadEnvFile('.env.local');

async function main() {
  const { reaAutoComplete } = await import('@/tools/rapidapi/rea');
  const { fetchReaSoldComparables } = await import('@/tools/comps/reaComps');
  const { visionAnalyseComps } = await import('@/agents/nodes/04b_visionAnalyseComps');

  const query = process.argv[2] ?? 'Mosman NSW 2088';
  const subject = { lat: -33.8281, lng: 151.2413 };

  const locs = await reaAutoComplete(query);
  const locationId = locs[0]?.locationId;
  if (!locationId) throw new Error(`no REA locationId for "${query}"`);

  const comps = await fetchReaSoldComparables({ locationId, subject, maxPages: 2 });
  console.log(`\nfetched ${comps.length} sold comps for ${query}\n`);

  // Photo hosts after the youtube/video filter — should be REA CDN only.
  console.log('=== photo hosts (post-filter) ===');
  for (const c of comps.slice(0, 10)) {
    const hosts = [...new Set(c.photos.map((u) => new URL(u).host))];
    const youtube = hosts.some((h) => /youtube|youtu\.be|vimeo/i.test(h));
    console.log(
      `  ${c.id}: ${c.photos.length} photos [${hosts.join(', ') || 'none'}]${youtube ? '  <-- STILL HAS VIDEO HOST' : ''}`,
    );
  }

  // Run the real Node 04b on the first 3 comps that have photos.
  const withPhotos = comps.filter((c) => c.photos.length > 0).slice(0, 3);
  console.log(`\n=== comp vision on ${withPhotos.length} comps with photos ===`);
  // biome-ignore lint/suspicious/noExplicitAny: minimal state — the node only reads .comparables.
  const out = await visionAnalyseComps({ comparables: withPhotos } as any);
  for (const c of out.comparables ?? []) {
    const v = c.visionAnalysis;
    console.log(`\n  ${c.id} — ${c.address}`);
    if (!v) {
      console.log('    (no vision)');
      continue;
    }
    console.log(`    condition:  ${v.condition}`);
    console.log(`    layout:     ${JSON.stringify(v.layout)}`);
    console.log(`    factors:    ${v.presentationFactors.join('; ') || '—'}`);
    console.log(`    red flags:  ${v.redFlags.join('; ') || '—'}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nFATAL:', e instanceof Error ? e.stack : e);
    process.exit(1);
  });
