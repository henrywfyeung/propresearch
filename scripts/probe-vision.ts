// scripts/probe-vision.ts — de-risk the gpt-5.4 VISION path before building Node
// 04c (street view). Fetches a real Google Static Street View image (bytes, server-
// side — the keyed URL must NOT be sent to OpenAI), then asks gpt-5.4 vision for a
// structured perception of the street. Tests two call shapes to learn which the
// vision node should use:
//   A) no reasoning_effort + functionCalling + temp0   (the "simple" path)
//   B) reasoning_effort:'low' + streaming + jsonSchema + temp1  (the proven path)
//
// Usage: pnpm tsx scripts/probe-vision.ts

import process from 'node:process';

process.loadEnvFile('.env.local');

async function main() {
  const { ChatOpenAI } = await import('@langchain/openai');
  const { HumanMessage } = await import('@langchain/core/messages');
  const { z } = await import('zod');

  const key = process.env.GOOGLE_MAPS_KEY;
  const model = process.env.OPENAI_MODEL_VISION || process.env.OPENAI_MODEL_REASONING || 'gpt-5.4';
  if (!key) throw new Error('GOOGLE_MAPS_KEY not set');
  console.log(`vision model: ${model}\n`);

  // Mosman subject coords from the live run.
  const lat = -33.822065;
  const lng = 151.249272;
  const url = `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=0&pitch=0&fov=90&return_error_code=true&key=${key}`;
  const res = await fetch(url);
  console.log(`street view fetch: HTTP ${res.status} ${res.headers.get('content-type')}`);
  if (!res.ok) {
    console.log('no imagery / fetch failed — body:', (await res.text()).slice(0, 200));
    return;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  console.log(`image bytes: ${bytes.length} (~${Math.round((bytes.length * 4) / 3 / 1024)}KB base64)`);
  const dataUrl = `data:${res.headers.get('content-type') ?? 'image/jpeg'};base64,${bytes.toString('base64')}`;

  const schema = z.object({
    streetCharacter: z.enum([
      'leafy-residential',
      'arterial',
      'commercial-frontage',
      'industrial-adjacent',
      'mixed',
      'unclassified',
    ]),
    busyRoad: z.boolean(),
    treeCover: z.enum(['high', 'medium', 'low']),
    neighbouringConcerns: z.array(z.string()).max(4),
  });
  const content = [
    {
      type: 'text',
      text: 'Assess this residential street from the Street View image. Return the structured perception fields.',
    },
    { type: 'image_url', image_url: { url: dataUrl } },
  ];

  const run = async (label: string, makeChat: () => unknown, withOpts: Record<string, unknown>) => {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: probe-only dynamic chat construction
      const chat = makeChat() as any;
      const structured = chat.withStructuredOutput(schema, { includeRaw: true, ...withOpts });
      const t0 = Date.now();
      const r = (await structured.invoke([new HumanMessage({ content })])) as { parsed: unknown };
      console.log(`✅ ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${JSON.stringify(r.parsed)}`);
    } catch (e) {
      console.log(`❌ ${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // A) simple: no reasoning_effort, functionCalling (default), temp 0
  await run('no-effort + functionCalling + temp0', () => new ChatOpenAI({ model, temperature: 0 }), {});

  // B) proven: reasoning_effort low, streaming, jsonSchema, temp 1
  await run(
    'effort:low + streaming + jsonSchema + temp1',
    () => new ChatOpenAI({ model, temperature: 1, streaming: true, modelKwargs: { reasoning_effort: 'low' } }),
    { method: 'jsonSchema' },
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL:', e instanceof Error ? e.stack : e);
    process.exit(1);
  });
