// scripts/probe-gpt54-schema.ts — does the REAL ReasonSelectOutputSchema survive
// gpt-5.4 via langchain's method:'jsonSchema' (OpenAI strict json_schema) with
// reasoning_effort:'high' + temperature:1? The schema has min/max/minLength/
// maxItems constraints that strict mode may reject. This is the go/no-go for
// "Path C" (keep high reasoning without a Responses-API dep bump).
//
// Usage: pnpm tsx scripts/probe-gpt54-schema.ts

import process from 'node:process';

process.loadEnvFile('.env.local');

async function main() {
  const { ChatOpenAI } = await import('@langchain/openai');
  const { ReasonSelectOutputSchema } = await import('@/schemas/reasonSelect');
  const model = process.env.OPENAI_MODEL_REASONING ?? 'gpt-5.4';
  console.log(`model: ${model}\n`);

  const tryIt = async (label: string, opts: Record<string, unknown>, withOpts: Record<string, unknown>) => {
    try {
      const chat = new ChatOpenAI({ model, ...opts });
      const structured = chat.withStructuredOutput(ReasonSelectOutputSchema, {
        includeRaw: true,
        ...withOpts,
      });
      const r = (await structured.invoke([
        ['human', 'There are no candidate comparables to assess. Return decisions as an empty array.'],
      ])) as { parsed: unknown };
      console.log(`✅ ${label} -> parsed: ${JSON.stringify(r.parsed)}`);
    } catch (e) {
      console.log(`❌ ${label} -> ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Path C: json_schema strict + reasoning_effort high + temperature 1
  await tryIt(
    'jsonSchema + effort:high + temp1',
    { temperature: 1, modelKwargs: { reasoning_effort: 'high' } },
    { method: 'jsonSchema' },
  );
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
