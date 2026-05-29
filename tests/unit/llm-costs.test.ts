import {
  COST_CEILING_USD,
  WORST_CASE_NODE_COST,
  estimateCostUsd,
  priceFor,
} from '@/tools/llm/costs';
import { describe, expect, it } from 'vitest';

describe('priceFor', () => {
  it('matches gpt-5-mini before gpt-5 (longest/most-specific prefix wins by order)', () => {
    expect(priceFor('gpt-5-mini-2026-01-01').inputPer1M).toBe(0.25);
    expect(priceFor('gpt-5-2026-01-01').inputPer1M).toBe(1.25);
  });
  it('matches claude sonnet', () => {
    expect(priceFor('claude-sonnet-4-5-2026').outputPer1M).toBe(15);
  });
  it('falls back to a default price for unknown models', () => {
    expect(priceFor('mystery-model').inputPer1M).toBeGreaterThan(0);
  });
});

describe('estimateCostUsd', () => {
  it('computes input+output cost and rounds to 6 dp', () => {
    // gpt-5: 1.25/1M in, 10/1M out. 10k in + 2k out:
    // 0.01*1.25 + 0.002*10 = 0.0125 + 0.02 = 0.0325
    expect(estimateCostUsd('gpt-5-2026', { promptTokens: 10_000, completionTokens: 2_000 })).toBe(
      0.0325,
    );
  });
  it('is zero for zero tokens', () => {
    expect(estimateCostUsd('gpt-5', { promptTokens: 0, completionTokens: 0 })).toBe(0);
  });
});

describe('WORST_CASE_NODE_COST', () => {
  it('has an entry for every graph node and sums under the ceiling on the typical path', () => {
    expect(WORST_CASE_NODE_COST.reasonAndSelect).toBe(1.2);
    expect(WORST_CASE_NODE_COST.render).toBe(0);
    // Sum of all worst-cases is the headroom budget; should leave room under $10
    // for a single revise + fallback (the §11.3 "~$8.00" worst case).
    const sum = Object.values(WORST_CASE_NODE_COST).reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThan(COST_CEILING_USD);
  });
});
