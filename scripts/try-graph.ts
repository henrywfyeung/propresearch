// scripts/try-graph.ts — manual end-to-end runner against LIVE Mapbox + REA.
// Validates that the mocked assumptions hold on real data.
//
// Usage:
//   RAPIDAPI_KEY=... [MAPBOX_TOKEN=...] pnpm tsx scripts/try-graph.ts ["an address"]
//
// Without MAPBOX_TOKEN it skips geocoding and uses a seeded Mosman address for
// the comp step (the REA chain is the higher-risk part to validate live).

import { runWithReportContext } from '@/agents/reportContext';
import { selectComparables } from '@/tools/comps/selectComparables';
import { forwardGeocode } from '@/tools/mapbox/geocode';

async function main() {
  const address = process.argv[2] ?? '1 Awaba Street, Mosman NSW 2088';
  const hasRea = !!process.env.RAPIDAPI_KEY;
  const hasMapbox = !!process.env.MAPBOX_TOKEN;
  console.log(
    `REA key: ${hasRea ? 'present' : 'MISSING'} | Mapbox token: ${hasMapbox ? 'present' : 'MISSING'}`,
  );
  console.log(`address: ${address}\n`);

  let geo = { lat: -33.8284, lng: 151.2454 };
  let location = { suburb: 'Mosman', state: 'NSW', postcode: '2088' };

  if (hasMapbox) {
    console.log('=== forwardGeocode (LIVE Mapbox) ===');
    const g = await forwardGeocode(address);
    console.log(JSON.stringify(g, null, 2));
    if (g?.suburb && g.postcode && g.state) {
      geo = { lat: g.lat, lng: g.lng };
      location = { suburb: g.suburb, state: g.state, postcode: g.postcode };
    } else {
      console.log('(geocode incomplete — falling back to seeded Mosman for the comp step)');
    }
  } else {
    console.log('(skipping Mapbox — no MAPBOX_TOKEN; using seeded Mosman address for comps)');
  }

  if (!hasRea) {
    console.log('\nNo RAPIDAPI_KEY — cannot run the REA comp step.');
    return;
  }

  console.log(
    `\n=== selectComparables [LIVE REA] suburb=${location.suburb} | subject=House 3bd/2ba 500sqm ===`,
  );
  const comps = await runWithReportContext({ reportId: 'live-validate' }, () =>
    selectComparables({
      subject: { beds: 3, baths: 2, landArea: 500, propertyType: 'House' },
      geo,
      location,
    }),
  );

  console.log(`candidates returned: ${comps.length}\n`);
  for (const c of comps.slice(0, 8)) {
    console.log(
      `  [score ${c.similarityScore.toFixed(0)}] ${c.id}  $${c.salePrice.toLocaleString()}  ${c.contractDate}  ${Math.round(c.distanceM)}m  ${c.propertyType}  ${c.beds}bd/${c.baths}ba  ${c.photos.length}photos`,
    );
    console.log(`            ${c.address}`);
  }

  const priced = comps.filter((c) => c.salePrice > 0).length;
  const withPhotos = comps.filter((c) => c.photos.length > 0).length;
  const dates = comps
    .map((c) => c.contractDate)
    .filter(Boolean)
    .sort();
  console.log(
    `\n  sanity: ${priced}/${comps.length} priced | ${withPhotos}/${comps.length} with photos | dates ${dates[0] ?? '-'} .. ${dates[dates.length - 1] ?? '-'}`,
  );
}

main().catch((e) => {
  console.error('\nFATAL:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
