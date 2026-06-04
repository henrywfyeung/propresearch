// src/agents/nodes/07_triangulate.ts — Node 07 (CLAUDE.md §7.9, v2 comp-only).
// Deterministic: reconciles the fair-value comps into a similarity-weighted value
// range, and derives verdict-banded price bounds (inferior cap / comparable band
// / superior floor) that corroborate the estimate. No LLM; prose is Node 10.

import type { GraphState } from '@/agents/annotation';
import type { Comparable, ValuationBands } from '@/schemas/state';

/**
 * Group the comps' raw sold prices by `verdict` to produce the corroborating
 * bands (adopted from a professional CMA's banded scatter). Uses the WHOLE pool
 * — including comps the model rejected for selection — because an inferior or
 * superior sale still informs where the subject sits. Returns null when no comp
 * carries a verdict (degraded / pre-verdict reports).
 */
export function computeValuationBands(comps: Comparable[]): ValuationBands | null {
  const withVerdict = comps.filter((c) => c.verdict != null);
  if (withVerdict.length === 0) return null;

  const pricesOf = (v: Comparable['verdict']) =>
    withVerdict.filter((c) => c.verdict === v).map((c) => c.salePrice);
  const inferior = pricesOf('inferior');
  const comparable = pricesOf('comparable');
  const superior = pricesOf('superior');

  return {
    inferiorCap: inferior.length ? Math.max(...inferior) : null,
    comparableLow: comparable.length ? Math.min(...comparable) : null,
    comparableHigh: comparable.length ? Math.max(...comparable) : null,
    superiorFloor: superior.length ? Math.min(...superior) : null,
    counts: {
      inferior: inferior.length,
      comparable: comparable.length,
      superior: superior.length,
    },
  };
}

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

  const bands = computeValuationBands(state.comparables);

  const fmt = (n: number) => `$${n.toLocaleString()}`;
  const uncertaintyNote =
    spread > 0.25
      ? `The selected comparables' adjusted values span ${fmt(low)}-${fmt(high)} (a wide range), so treat the estimate as indicative rather than precise.`
      : null;

  // Corroborate the similarity-weighted estimate with the verdict bands, and
  // flag the case where it falls outside the inferior→superior bracket.
  const bandBits: string[] = [];
  if (bands) {
    if (bands.comparableLow != null && bands.comparableHigh != null) {
      bandBits.push(
        bands.comparableLow === bands.comparableHigh
          ? `like-for-like sales around ${fmt(bands.comparableLow)}`
          : `like-for-like sales cluster ${fmt(bands.comparableLow)}-${fmt(bands.comparableHigh)}`,
      );
    }
    if (bands.inferiorCap != null)
      bandBits.push(`inferior sales top out near ${fmt(bands.inferiorCap)}`);
    if (bands.superiorFloor != null)
      bandBits.push(`superior sales start near ${fmt(bands.superiorFloor)}`);
  }
  const outsideBracket =
    bands != null &&
    ((bands.inferiorCap != null && compDerived < bands.inferiorCap) ||
      (bands.superiorFloor != null && compDerived > bands.superiorFloor));

  const bandClause = bandBits.length ? ` By quality verdict, ${bandBits.join('; ')}.` : '';
  const outsideClause = outsideBracket
    ? ' Note: the estimate sits outside the inferior-to-superior bracket implied by the banded sales — treat with added caution.'
    : '';
  const narrative = `Derived from ${selected.length} fair-value comparable${selected.length === 1 ? '' : 's'}; similarity-weighted estimate ${fmt(compDerived)} with a range of ${fmt(low)}-${fmt(high)}.${bandClause}${outsideClause}`;

  return {
    triangulation: {
      compDerived,
      low,
      high,
      reconciled: compDerived,
      confidence,
      spread,
      compIds: selected.map((c) => c.id),
      bands,
      uncertaintyNote,
      narrative,
    },
  };
}
