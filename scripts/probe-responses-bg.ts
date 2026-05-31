// scripts/probe-responses-bg.ts — confirm HIGH-effort gpt-5.4 reasoning via the
// Responses API BACKGROUND mode (create + poll; no held connection → no 60s edge
// limit). The earlier probe proved background COMPLETES; this fixes output
// extraction (resp.output_text is absent on a retrieved bg response — the JSON is
// in resp.output[message].content[].text) and confirms parse + usage + timing.
//
// Usage: pnpm tsx scripts/probe-responses-bg.ts

import process from 'node:process';

process.loadEnvFile('.env.local');

function syntheticComps(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    address: `${10 + i} Example Street, Mosman NSW 2088`,
    salePrice: 3_000_000 + i * 75_000,
    contractDate: `2025-${String(7 + (i % 5)).padStart(2, '0')}-15`,
    distanceM: 120 + i * 35,
    beds: 3 + (i % 3),
    baths: 1 + (i % 3),
    landArea: 450 + (i % 7) * 60,
    propertyType: 'House',
    similarityScore: 95 - i,
  }));
}

// biome-ignore lint/suspicious/noExplicitAny: probing SDK response shape
function extractOutputText(resp: any): string {
  if (typeof resp.output_text === 'string' && resp.output_text.length > 0) return resp.output_text;
  const msg = resp.output?.find((o: any) => o.type === 'message');
  const part = msg?.content?.find((c: any) => c.type === 'output_text');
  return part?.text ?? '';
}

async function main() {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const openaiBase = createRequire(req.resolve('@langchain/openai'));
  const { default: OpenAI } = await import(openaiBase.resolve('openai'));
  const { zodTextFormat } = await import(openaiBase.resolve('openai/helpers/zod'));
  const { buildMessages } = await import('@/prompts/reasonAndSelect');
  const { ReasonSelectOutputSchema } = await import('@/schemas/reasonSelect');

  // biome-ignore lint/suspicious/noExplicitAny: SDK shapes vary across versions
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as any;
  const model = process.env.OPENAI_MODEL_REASONING ?? 'gpt-5.4';
  console.log(`model: ${model} (background, effort=high)\n`);

  const comps = syntheticComps(30);
  const messages = buildMessages({
    subject: {
      suburb: 'Mosman',
      attrs: { beds: 4, baths: 2, parking: 2, landArea: 600, buildingArea: null, propertyType: 'House' },
    },
    comps,
  });
  const input = messages.map((m) => ({ role: m.role === 'system' ? 'developer' : m.role, content: m.content }));
  const format = zodTextFormat(ReasonSelectOutputSchema, 'reasonSelect');

  const t0 = Date.now();
  let resp = await client.responses.create({
    model,
    reasoning: { effort: 'high' },
    input,
    text: { format },
    background: true,
  });
  console.log(`created: id=${resp.id} status=${resp.status}`);
  let polls = 0;
  while (resp.status === 'queued' || resp.status === 'in_progress') {
    await new Promise((r) => setTimeout(r, 3000));
    resp = await client.responses.retrieve(resp.id);
    polls++;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`final: status=${resp.status} after ${secs}s / ${polls} polls`);
  console.log(`output item types: ${JSON.stringify(resp.output?.map((o: any) => o.type))}`);
  console.log(
    `usage: in=${resp.usage?.input_tokens} out=${resp.usage?.output_tokens} reasoning=${resp.usage?.output_tokens_details?.reasoning_tokens}`,
  );

  const text = extractOutputText(resp);
  console.log(`output_text length: ${text.length}`);
  try {
    const parsed = ReasonSelectOutputSchema.parse(JSON.parse(text));
    const sel = parsed.decisions.reduce<Record<string, number>>((m, d) => {
      m[d.selection] = (m[d.selection] ?? 0) + 1;
      return m;
    }, {});
    console.log(`✅ parsed ${parsed.decisions.length} decisions ${JSON.stringify(sel)}`);
  } catch (e) {
    console.log(`❌ parse failed: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`text head: ${text.slice(0, 200)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL:', e instanceof Error ? e.stack : e);
    process.exit(1);
  });
