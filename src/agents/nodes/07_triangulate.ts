// src/agents/nodes/07_triangulate.ts — Node 07 (CLAUDE.md §7.9, v2 comp-only).
// Deterministic: reconciles the fair-value comps into a similarity-weighted value
// range. No LLM; the prose is Node 10 (compose).

import type { GraphState } from '@/agents/annotation';

export function triangulate(state: GraphState): Partial<GraphState> {
  const selected = state.comparables.filter((c) => c.selection === 'fair-value');
  if (selected.length === 0) {
    return {
      errors: [{ code: 'PARTIAL_DATA', message: 'triangulate: no fair-value comps to value from' }],
    };
  }

  const entries = selected.map((c) => ({
    value: c.adjustedValue ?? c.salePrice,
    weight: Math.max(1, c.similarityScore),
  }));
  const weightSum = entries.reduce((a, e) => a + e.weight, 0);
  const compDerived = Math.round(entries.reduce((a, e) => a + e.value * e.weight, 0) / weightSum);

  const values = entries.map((e) => e.value).sort((a, b) => a - b);
  const low = values[0] ?? compDerived;
  const high = values[values.length - 1] ?? compDerived;
  const median = values[Math.floor(values.length / 2)] ?? compDerived;
  const spread = median > 0 ? (high - low) / median : 0;

  const confidence: 'high' | 'medium' | 'low' =
    spread <= 0.1 && selected.length >= 3 ? 'high' : spread <= 0.25 ? 'medium' : 'low';

  const fmt = (n: number) => `$${n.toLocaleString()}`;
  const uncertaintyNote =
    spread > 0.25
      ? `The selected comparables' adjusted values span ${fmt(low)}-${fmt(high)} (a wide range), so treat the estimate as indicative rather than precise.`
      : null;
  const narrative = `Derived from ${selected.length} fair-value comparable${selected.length === 1 ? '' : 's'}; similarity-weighted estimate ${fmt(compDerived)} with a range of ${fmt(low)}-${fmt(high)}.`;

  return {
    triangulation: {
      compDerived,
      low,
      high,
      reconciled: compDerived,
      confidence,
      spread,
      compIds: selected.map((c) => c.id),
      uncertaintyNote,
      narrative,
    },
  };
}
