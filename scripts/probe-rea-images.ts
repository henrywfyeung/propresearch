// scripts/probe-rea-images.ts — does the REA RapidAPI return REAL property photos
// for any channel? Sold listings gave placeholders; check buy/rent (active) too by
// fetching the first image of each and comparing byte sizes (a real photo >> a
// "no image" placeholder). Usage: pnpm tsx scripts/probe-rea-images.ts

import process from 'node:process';

process.loadEnvFile('.env.local');

async function main() {
  const { rapidApiCall } = await import('@/tools/rapidapi/client');
  const { reaAutoComplete, REA_HOST } = await import('@/tools/rapidapi/rea');
  const { z } = await import('zod');

  const locs = await reaAutoComplete('Mosman NSW 2088');
  const locationId = locs[0]?.locationId;
  if (!locationId) throw new Error('no locationId');
  console.log(`locationId: ${locationId}\n`);

  const Envelope = z.object({ data: z.array(z.unknown()) });

  async function firstImageUrl(channel: string): Promise<string | null> {
    const res = await rapidApiCall({
      host: REA_HOST,
      path: '/properties/search',
      params: { locationId, channel, page: 1 },
      schema: Envelope,
    });
    for (const item of res.data) {
      // biome-ignore lint/suspicious/noExplicitAny: probing loose REA shape
      const imgs = (item as any)?.images as { server: string; uri: string }[] | undefined;
      if (imgs?.[0]) return `${imgs[0].server}${imgs[0].uri}`;
    }
    return null;
  }

  for (const ch of ['buy', 'rent', 'sold']) {
    try {
      const url = await firstImageUrl(ch);
      if (!url) {
        console.log(`${ch.padEnd(5)}: (no listings/images)`);
        continue;
      }
      const r = await fetch(url);
      const bytes = (await r.arrayBuffer()).byteLength;
      const verdict = bytes > 15_000 ? 'REAL photo' : 'placeholder?';
      console.log(`${ch.padEnd(5)}: ${r.status} ${r.headers.get('content-type')} ${bytes} bytes [${verdict}] — ${url.slice(0, 64)}`);
    } catch (e) {
      console.log(`${ch.padEnd(5)}: ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL:', e instanceof Error ? e.stack : e);
    process.exit(1);
  });
