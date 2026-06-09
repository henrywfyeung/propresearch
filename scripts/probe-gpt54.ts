// scripts/probe-gpt54.ts — map the gpt-5.4 structured-output constraint space.
// The live run hit: "Function tools with reasoning_effort are not supported for
// gpt-5.4 in /v1/chat/completions. Please use /v1/responses instead." This probes
// the variants to find which call shape we should adopt in structuredCall.ts.
//
// Usage: pnpm tsx scripts/probe-gpt54.ts

import process from 'node:process';

process.loadEnvFile('.env.local');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { answer: { type: 'string' } },
  required: ['answer'],
} as const;

async function main() {
  // `openai` is a transitive dep of @langchain/openai (pnpm-hoisted, not directly
  // resolvable from the repo root); resolve it via langchain's module context.
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const openaiEntry = createRequire(req.resolve('@langchain/openai')).resolve('openai');
  const { default: OpenAI } = await import(openaiEntry);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL_REASONING ?? 'gpt-5.4';
  console.log(`probing model: ${model}\n`);

  async function probe(name: string, fn: () => Promise<unknown>) {
    try {
      const r = await fn();
      console.log(`✅ ${name} -> ${JSON.stringify(r)?.slice(0, 100)}`);
    } catch (e) {
      console.log(`❌ ${name} -> ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const msg = [{ role: 'user' as const, content: 'Reply with answer set to the string "hi".' }];
  const jsonSchema = { type: 'json_schema' as const, json_schema: { name: 'A', schema: SCHEMA, strict: true } };

  // --- Chat Completions variants ---
  await probe('chat + tool(function) + effort + temp0 (CURRENT, known-bad)', () =>
    client.chat.completions
      .create({
        model,
        temperature: 0,
        reasoning_effort: 'high',
        tools: [{ type: 'function', function: { name: 'A', parameters: SCHEMA, strict: true } }],
        tool_choice: { type: 'function', function: { name: 'A' } },
        messages: msg,
      })
      .then((r) => r.choices[0]?.message?.tool_calls?.[0]?.function?.arguments),
  );

  await probe('chat + json_schema + effort + temp1(default)', () =>
    client.chat.completions
      .create({ model, reasoning_effort: 'high', response_format: jsonSchema, messages: msg })
      .then((r) => r.choices[0]?.message?.content),
  );

  await probe('chat + json_schema + effort + temp0', () =>
    client.chat.completions
      .create({ model, temperature: 0, reasoning_effort: 'high', response_format: jsonSchema, messages: msg })
      .then((r) => r.choices[0]?.message?.content),
  );

  await probe('chat + json_schema (no effort) + temp0', () =>
    client.chat.completions
      .create({ model, temperature: 0, response_format: jsonSchema, messages: msg })
      .then((r) => r.choices[0]?.message?.content),
  );

  await probe('chat + tool(function) (no effort) + temp0', () =>
    client.chat.completions
      .create({
        model,
        temperature: 0,
        tools: [{ type: 'function', function: { name: 'A', parameters: SCHEMA, strict: true } }],
        tool_choice: { type: 'function', function: { name: 'A' } },
        messages: msg,
      })
      .then((r) => r.choices[0]?.message?.tool_calls?.[0]?.function?.arguments),
  );

  // --- Responses API variants ---
  await probe('responses + json_schema + effort', () =>
    // biome-ignore lint/suspicious/noExplicitAny: probing SDK shape across versions
    (client as any).responses
      .create({
        model,
        reasoning: { effort: 'high' },
        text: { format: { type: 'json_schema', name: 'A', schema: SCHEMA, strict: true } },
        input: msg,
      })
      .then((r: { output_text?: string }) => r.output_text),
  );
}

main().catch((e) => {
  console.error('PROBE FATAL:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
