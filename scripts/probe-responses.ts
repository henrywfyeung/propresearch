// scripts/probe-responses.ts — de-risk HIGH-effort gpt-5.4 reasoning via the
// OpenAI Responses API (langchain 0.3.14 can't reach it, so call the SDK direct).
// Chat Completions dies at the ~60s edge time-to-first-byte limit because gpt-5.x
// reasons silently >60s at high effort. The Responses API offers two escapes:
//   A) streaming  — stays alive IF it emits in-progress/reasoning bytes while thinking
//   B) background:true + poll — no held connection, so the 60s limit can't apply
// Tests A first (simpler to implement); only tries B if A fails. Uses the REAL
// reasonAndSelect prompt + schema with a 30-comp payload.
//
// Usage: pnpm tsx scripts/probe-responses.ts

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

async function main() {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const openaiBase = createRequire(req.resolve('@langchain/openai'));
  const { default: OpenAI } = await import(openaiBase.resolve('openai'));
  const { zodTextFormat } = await import(openaiBase.resolve('openai/helpers/zod'));
  const { buildMessages } = await import('@/prompts/reasonAndSelect');
  const { ReasonSelectOutputSchema } = await import('@/schemas/reasonSelect');

  // biome-ignore lint/suspicious/noExplicitAny: probe-only SDK shapes vary across versions
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) as any;
  const model = process.env.OPENAI_MODEL_REASONING ?? 'gpt-5.4';
  console.log(`model: ${model}\n`);

  const comps = syntheticComps(30);
  const messages = buildMessages({
    subject: {
      suburb: 'Mosman',
      attrs: { beds: 4, baths: 2, parking: 2, landArea: 600, buildingArea: null, propertyType: 'House' },
    },
    comps,
  });
  // Responses API: map our system/user roles; 'developer' is preferred over 'system'
  // for reasoning models.
  const input = messages.map((m) => ({
    role: m.role === 'system' ? 'developer' : m.role,
    content: m.content,
  }));
  const format = zodTextFormat(ReasonSelectOutputSchema, 'reasonSelect');

  let streamingWorks = false;

  // A) streaming
  try {
    const t0 = Date.now();
    const stream = client.responses.stream({
      model,
      reasoning: { effort: 'high' },
      input,
      text: { format },
    });
    const final = await stream.finalResponse();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const parsed = final.output_parsed ?? JSON.parse(final.output_text ?? '{}');
    console.log(
      `✅ A) stream high: ${secs}s | decisions=${parsed?.decisions?.length} | in=${final.usage?.input_tokens} out=${final.usage?.output_tokens} reasoning=${final.usage?.output_tokens_details?.reasoning_tokens}`,
    );
    streamingWorks = true;
  } catch (e) {
    console.log(`❌ A) stream high: ${e instanceof Error ? e.message : String(e)}`);
  }

  // B) background + poll (only if streaming didn't work — saves a high-effort call)
  if (!streamingWorks) {
    try {
      const t0 = Date.now();
      let resp = await client.responses.create({
        model,
        reasoning: { effort: 'high' },
        input,
        text: { format },
        background: true,
      });
      let polls = 0;
      while (resp.status === 'queued' || resp.status === 'in_progress') {
        await new Promise((r) => setTimeout(r, 3000));
        resp = await client.responses.retrieve(resp.id);
        polls++;
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const parsed = ReasonSelectOutputSchema.parse(JSON.parse(resp.output_text ?? '{}'));
      console.log(
        `✅ B) background high: ${secs}s (${polls} polls) | status=${resp.status} | decisions=${parsed.decisions.length} | in=${resp.usage?.input_tokens} out=${resp.usage?.output_tokens} reasoning=${resp.usage?.output_tokens_details?.reasoning_tokens}`,
      );
    } catch (e) {
      console.log(`❌ B) background high: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    console.log('(skipping background probe — streaming already works)');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL:', e instanceof Error ? e.stack : e);
    process.exit(1);
  });
