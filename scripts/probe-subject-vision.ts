// scripts/probe-subject-vision.ts — de-risk gpt-5.4 VISION on real property photos
// before building Node 04a (visionAnalyseSubject). Pulls a live Mosman REA listing's
// photo URLs and asks gpt-5.4 vision for the §7.4 structured perception (condition,
// staging, presentationFactors, redFlags + a narrative). Tests the no-reasoning
// functionCalling+temp0 path (vision is perception, not deep reasoning).
//
// Usage: pnpm tsx scripts/probe-subject-vision.ts

import process from 'node:process';

process.loadEnvFile('.env.local');

async function main() {
  const { reaAutoComplete, reaSearchSold } = await import('@/tools/rapidapi/rea');
  const { ChatOpenAI } = await import('@langchain/openai');
  const { HumanMessage } = await import('@langchain/core/messages');
  const { z } = await import('zod');

  // 1. Grab a real Mosman listing's photos (validates the realistic photo path).
  const locs = await reaAutoComplete('Mosman NSW 2088');
  const locationId = locs[0]?.locationId;
  if (!locationId) throw new Error('no locationId');
  const listings = await reaSearchSold(locationId);
  const withPhotos = listings.find((l) => (l.images?.length ?? 0) >= 3);
  if (!withPhotos) throw new Error('no listing with photos');
  const photos = (withPhotos.images ?? []).slice(0, 4).map((i) => `${i.server}${i.uri}`);
  console.log(`using ${photos.length} photos from a Mosman listing:\n${photos.join('\n')}\n`);

  const schema = z.object({
    condition: z.enum(['excellent', 'good', 'fair', 'poor', 'unliveable']),
    staging: z.enum([
      'professionally-staged',
      'lived-in-tidy',
      'lived-in-cluttered',
      'vacant',
      'partly-furnished',
    ]),
    presentationFactors: z.array(z.string().max(80)).max(6),
    redFlags: z.array(z.string().max(80)).max(6),
    comment: z.string().min(40),
  });

  const model = process.env.OPENAI_MODEL_VISION || process.env.OPENAI_MODEL_REASONING || 'gpt-5.4';
  const content = [
    {
      type: 'text',
      text: 'You are inspecting a residential property from its listing photos. Assess overall condition, staging/presentation, and any visible red flags. Be specific and conservative.',
    },
    ...photos.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];

  const run = async (label: string, makeChat: () => unknown, withOpts: Record<string, unknown>) => {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: probe-only
      const chat = makeChat() as any;
      const structured = chat.withStructuredOutput(schema, { includeRaw: true, ...withOpts });
      const t0 = Date.now();
      const r = (await structured.invoke([new HumanMessage({ content })])) as { parsed: unknown };
      console.log(`✅ ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s\n${JSON.stringify(r.parsed, null, 2)}`);
    } catch (e) {
      console.log(`❌ ${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await run('no-effort + functionCalling + temp0', () => new ChatOpenAI({ model, temperature: 0 }), {});
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL:', e instanceof Error ? e.stack : e);
    process.exit(1);
  });
