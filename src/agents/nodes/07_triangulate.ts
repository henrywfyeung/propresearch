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

  const rawBands = computeValuationBands(state.comparables);

  // The verdict bands are reliable ONLY when the quick quality verdicts line up
  // with price — a non-inverted bracket (inferior cap < superior floor) and a
  // not-absurdly-wide comparable band. In heterogeneous markets they often
  // don't (a "worse" property can sell for more), which previously produced an
  // alarming, repeated "estimate outside the bracket" caution. So we gate on
  // reliability, suppress the bands entirely when unreliable, and NEVER raise an
  // alarm from them — they are soft market context, not the estimate. [R-quality]
  const bracketInverted =
    rawBands?.inferiorCap != null &&
    rawBands.superiorFloor != null &&
    rawBands.inferiorCap >= rawBands.superiorFloor;
  const comparableTooWide =
    rawBands?.comparableLow != null &&
    rawBands.comparableHigh != null &&
    rawBands.comparableLow > 0 &&
    rawBands.comparableHigh / rawBands.comparableLow > 1.5;
  const groups = rawBands
    ? [rawBands.inferiorCap, rawBands.comparableLow, rawBands.superiorFloor].filter(
        (x) => x != null,
      ).length
    : 0;
  const bands = rawBands && !bracketInverted && !comparableTooWide && groups >= 2 ? rawBands : null;

  const fmt = (n: number) => `$${n.toLocaleString()}`;
  const uncertaintyNote =
    spread > 0.25
      ? `The selected comparables' adjusted values span ${fmt(low)}-${fmt(high)} (a wide range), so treat the estimate as indicative rather than precise.`
      : null;

  // Neutral band context only (no "outside bracket" alarm).
  const bandBits: string[] = [];
  if (bands) {
    if (bands.comparableLow != null && bands.comparableHigh != null) {
      bandBits.push(
        bands.comparableLow === bands.comparableHigh
          ? `like-for-like sales around ${fmt(bands.comparableLow)}`
          : `like-for-like sales ${fmt(bands.comparableLow)}-${fmt(bands.comparableHigh)}`,
      );
    }
    if (bands.inferiorCap != null) bandBits.push(`lower-graded up to ${fmt(bands.inferiorCap)}`);
    if (bands.superiorFloor != null)
      bandBits.push(`higher-graded from ${fmt(bands.superiorFloor)}`);
  }
  const bandClause = bandBits.length ? ` For market context, ${bandBits.join('; ')}.` : '';
  const narrative = `Derived from ${selected.length} fair-value comparable${selected.length === 1 ? '' : 's'}; similarity-weighted estimate ${fmt(compDerived)} with a range of ${fmt(low)}-${fmt(high)}.${bandClause}`;

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
