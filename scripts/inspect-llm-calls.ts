// scripts/inspect-llm-calls.ts — print the most recent llm_calls ledger rows
// (per-node model / tokens / cost / latency). Only successful calls are recorded
// (recordCall runs after a call returns), so a failed node leaves no row.
//
// Usage: pnpm tsx scripts/inspect-llm-calls.ts [limit]

import process from 'node:process';

process.loadEnvFile('.env.local');

async function main() {
  const { workerDb } = await import('@/db/client-worker');
  const { llmCalls } = await import('@/db/schema');
  const { desc } = await import('drizzle-orm');

  const limit = Number(process.argv[2] ?? 15);
  const rows = await workerDb.select().from(llmCalls).orderBy(desc(llmCalls.id)).limit(limit);

  let total = 0;
  for (const r of rows.slice().reverse()) {
    total += Number(r.costUsd);
    const t = r.createdAt.toISOString().slice(11, 19);
    console.log(
      `${t}  ${r.node.padEnd(18)} ${r.model.padEnd(11)} in=${String(r.promptTokens).padStart(6)} out=${String(r.completionTokens).padStart(5)}  $${Number(r.costUsd).toFixed(4)}  ${String(r.latencyMs ?? '?').padStart(6)}ms`,
    );
  }
  console.log(`\n${rows.length} rows; cost sum $${total.toFixed(4)}`);
}

// process.exit so the open workerDb pool doesn't keep the event loop alive.
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
