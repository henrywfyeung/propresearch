// LLM cost estimation + per-node worst-case budget (CLAUDE.md §11.3).
//
// estimateCostUsd is a pure function over a static price table keyed on model
// id. WORST_CASE_NODE_COST is the "Worst-case" column from the §11 table; the
// pre-node cost-ceiling guard ([R23]) uses it as a lookahead so a parallel
// fan-out can't blow past $10 between boundary checks.
//
// PRICES ARE ESTIMATES pinned to placeholder GPT-5 / Claude rates. They MUST
// be revisited when the real model IDs land in env (§9.1). Updating either
// table requires a PR.

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

interface Price {
  inputPer1M: number;
  outputPer1M: number;
}

// Match on model-id prefix so date-suffixed pins (gpt-5-2026-XX-XX) resolve.
const PRICE_TABLE: Array<{ prefix: string; price: Price }> = [
  { prefix: 'gpt-5-mini', price: { inputPer1M: 0.25, outputPer1M: 2.0 } },
  { prefix: 'gpt-5', price: { inputPer1M: 1.25, outputPer1M: 10.0 } },
  { prefix: 'claude-sonnet-4-5', price: { inputPer1M: 3.0, outputPer1M: 15.0 } },
  { prefix: 'claude-sonnet', price: { inputPer1M: 3.0, outputPer1M: 15.0 } },
];

const FALLBACK_PRICE: Price = { inputPer1M: 3.0, outputPer1M: 15.0 };

export function priceFor(model: string): Price {
  return PRICE_TABLE.find((e) => model.startsWith(e.prefix))?.price ?? FALLBACK_PRICE;
}

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const p = priceFor(model);
  const cost =
    (usage.promptTokens / 1_000_000) * p.inputPer1M +
    (usage.completionTokens / 1_000_000) * p.outputPer1M;
  // Round to the per-call ledger precision (numeric(10,6)).
  return Math.round(cost * 1_000_000) / 1_000_000;
}

// Worst-case per graph node — CLAUDE.md §11.3 table. Keyed on the §6.2 node
// names. Bumping any value requires a PR (the cost ceiling depends on it).
export const WORST_CASE_NODE_COST: Record<string, number> = {
  resolveAddress: 0.0,
  fetchSubject: 0.0,
  fetchCandidateComps: 0.0,
  visionSubject: 0.1,
  visionComps: 0.9,
  streetView: 0.04,
  visionStreetView: 0.04, // alias guard if the node is ever renamed
  planningAndNews: 0.04,
  reasonAndSelect: 1.2,
  triangulate: 0.12,
  fetchRentals: 0.0,
  fetchRisks: 0.0,
  compose: 0.9,
  critic: 0.4,
  revise: 1.4,
  render: 0.0,
};

/** Extra headroom a single Claude fallback adds for the failing node (§11.3). */
export const FALLBACK_COST_ADD = 0.8;

export const COST_CEILING_USD = 10;
