// src/tools/llm/costSink.ts — optional in-memory per-call cost collector.
//
// Decoupled from reportCtx + the llm_calls ledger on purpose: a CLI / probe run
// has no `reports` row, so it can't tag llm_calls with a real reportId (FK to
// reports.id). This sink lets a one-off run collect every LLM call's cost in
// memory and print a per-node breakdown, without touching the DB path.
//
// When no sink is active (the normal app/server path), recordToSink is a no-op,
// so this has zero effect on production behaviour.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface LlmCallRecord {
  node: string; // 'reasonAndSelect' | 'visionComps' | 'compose:valuation' | ...
  provider: 'openai' | 'anthropic';
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
}

const sink = new AsyncLocalStorage<LlmCallRecord[]>();

/** Run `fn` with an active cost sink; returns the result plus the collected calls. */
export async function runWithCostSink<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; records: LlmCallRecord[] }> {
  const records: LlmCallRecord[] = [];
  const result = await sink.run(records, fn);
  return { result, records };
}

/**
 * Lower-level: run `fn` collecting into a CALLER-OWNED `records` array, so the
 * caller can still read what was spent in a `finally` even if `fn` throws
 * (e.g. a stalled reasoning node aborts the run mid-way).
 */
export function collectCalls<T>(records: LlmCallRecord[], fn: () => Promise<T>): Promise<T> {
  return sink.run(records, fn);
}

/** Push a call record to the active sink, if any (no-op otherwise). */
export function recordToSink(record: LlmCallRecord): void {
  sink.getStore()?.push(record);
}

// --------------------------------------------------------------------------
// Pure aggregation + formatting (no I/O) — unit-testable.
// --------------------------------------------------------------------------

export interface NodeCost {
  node: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface CostSummary {
  byNode: NodeCost[]; // sorted by cost desc
  byProvider: Array<{ provider: string; calls: number; costUsd: number }>;
  total: NodeCost; // node = 'TOTAL'
}

function emptyAgg(node: string): NodeCost {
  return { node, calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
}

function add(agg: NodeCost, r: LlmCallRecord): void {
  agg.calls += 1;
  agg.promptTokens += r.promptTokens;
  agg.completionTokens += r.completionTokens;
  agg.costUsd += r.costUsd;
}

/** Aggregate raw call records by node + provider, with a grand total. */
export function summarizeCalls(records: LlmCallRecord[]): CostSummary {
  const nodes = new Map<string, NodeCost>();
  const providers = new Map<string, { provider: string; calls: number; costUsd: number }>();
  const total = emptyAgg('TOTAL');

  for (const r of records) {
    const n = nodes.get(r.node) ?? emptyAgg(r.node);
    add(n, r);
    nodes.set(r.node, n);

    const p = providers.get(r.provider) ?? { provider: r.provider, calls: 0, costUsd: 0 };
    p.calls += 1;
    p.costUsd += r.costUsd;
    providers.set(r.provider, p);

    add(total, r);
  }

  const byNode = [...nodes.values()].sort((a, b) => b.costUsd - a.costUsd);
  const byProvider = [...providers.values()].sort((a, b) => b.costUsd - a.costUsd);
  return { byNode, byProvider, total };
}

const usd = (n: number): string => `$${n.toFixed(4)}`;

/** Render a fixed-width per-node cost table for the CLI. */
export function formatCostTable(summary: CostSummary): string {
  const rows = [...summary.byNode, summary.total];
  const nodeW = Math.max(12, ...rows.map((r) => r.node.length));
  const line = (r: NodeCost) =>
    `${r.node.padEnd(nodeW)}  ${String(r.calls).padStart(5)}  ${String(r.promptTokens).padStart(10)}  ${String(r.completionTokens).padStart(11)}  ${usd(r.costUsd).padStart(10)}`;

  const header = `${'node'.padEnd(nodeW)}  ${'calls'.padStart(5)}  ${'prompt_tok'.padStart(10)}  ${'compl_tok'.padStart(11)}  ${'cost_usd'.padStart(10)}`;
  const sep = '─'.repeat(header.length);

  const out = [header, sep];
  for (const r of summary.byNode) out.push(line(r));
  out.push(sep, line(summary.total));
  out.push(
    '',
    `by provider: ${summary.byProvider.map((p) => `${p.provider} ${usd(p.costUsd)} (${p.calls})`).join('  ·  ')}`,
  );
  return out.join('\n');
}
