// scripts/probe-reason.ts — isolate + time the Node 06 reasoning call with a
// realistic 30-comp payload (the real prompt via buildMessages), across reasoning
// efforts, maxRetries:0 so each attempt's duration + failure mode is visible.
// Goal: is gpt-5.4 high-effort over the full payload connection-resetting because
// it runs too long, and does a lower effort (or streaming) complete reliably?
//
// Usage: pnpm tsx scripts/probe-reason.ts

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
  const { ChatOpenAI } = await import('@langchain/openai');
  const { buildMessages } = await import('@/prompts/reasonAndSelect');
  const { ReasonSelectOutputSchema } = await import('@/schemas/reasonSelect');
  const model = process.env.OPENAI_MODEL_REASONING ?? 'gpt-5.4';

  const comps = syntheticComps(30);
  const messages = buildMessages({
    subject: {
      suburb: 'Mosman',
      attrs: { beds: 4, baths: 2, parking: 2, landArea: 600, buildingArea: null, propertyType: 'House' },
    },
    comps,
  });
  const lcMessages = messages.map((m) => [m.role === 'assistant' ? 'ai' : m.role, m.content] as [string, string]);
  const promptChars = messages.reduce((a, m) => a + m.content.length, 0);
  console.log(`model: ${model} | ${comps.length} comps | prompt ~${promptChars} chars (~${Math.round(promptChars / 4)} tokens)\n`);

  for (const effort of ['high', 'medium', 'low'] as const) {
    const chat = new ChatOpenAI({
      model,
      temperature: 1,
      maxRetries: 0,
      timeout: 300_000,
      // Stream the transport so response bytes flow immediately — avoids the
      // undici 60s headersTimeout that aborts long non-streamed reasoning calls.
      streaming: true,
      modelKwargs: { reasoning_effort: effort },
    });
    const structured = chat.withStructuredOutput(ReasonSelectOutputSchema, {
      includeRaw: true,
      method: 'jsonSchema',
    });
    const t0 = Date.now();
    try {
      const r = (await structured.invoke(lcMessages)) as {
        parsed: { decisions: { selection: string }[] };
        raw: { usage_metadata?: { input_tokens?: number; output_tokens?: number } };
      };
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const u = r.raw?.usage_metadata ?? {};
      const sel = r.parsed.decisions.reduce<Record<string, number>>((m, d) => {
        m[d.selection] = (m[d.selection] ?? 0) + 1;
        return m;
      }, {});
      console.log(`✅ ${effort}: ${secs}s | ${r.parsed.decisions.length} decisions ${JSON.stringify(sel)} | in=${u.input_tokens} out=${u.output_tokens}`);
    } catch (e) {
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`❌ ${effort}: ${secs}s | ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
