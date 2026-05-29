import { TriangulatedValueSchema } from '@/schemas/state';
// Triangulation schema tests — weights sum-to-1 [R14] + divergence guardrail
// [R44]. Pure schema validation, no LLM.
import { describe, expect, it } from 'vitest';

const base = {
  domainAvm: 1_200_000,
  domainAvmConfidence: 'high' as const,
  compDerived: 1_150_000,
  rentalImplied: 1_100_000,
  reconciled: 1_160_000,
  confidence: 'high' as const,
  spread: 0.083,
  weights: { domainAvm: 0.4, compDerived: 0.4, rentalImplied: 0.2 },
  uncertaintyNote: null,
  narrative:
    'The three value signals converge tightly, supporting a confident reconciled estimate.',
};

describe('TriangulatedValueSchema', () => {
  it('accepts weights summing to 1.0', () => {
    expect(TriangulatedValueSchema.safeParse(base).success).toBe(true);
  });

  it('rejects weights summing to 0.98', () => {
    const bad = { ...base, weights: { domainAvm: 0.4, compDerived: 0.4, rentalImplied: 0.18 } };
    expect(TriangulatedValueSchema.safeParse(bad).success).toBe(false);
  });

  it('allows null rentalImplied with two-channel weights summing to 1.0', () => {
    const noRent = {
      ...base,
      rentalImplied: null,
      weights: { domainAvm: 0.5, compDerived: 0.5 },
    };
    expect(TriangulatedValueSchema.safeParse(noRent).success).toBe(true);
  });

  it('high spread (>0.25) requires confidence=low AND an uncertaintyNote [R44]', () => {
    // spread high but confidence still high + no note → reject
    const bad = { ...base, spread: 0.5 };
    expect(TriangulatedValueSchema.safeParse(bad).success).toBe(false);

    // spread high, confidence low, note present → accept
    const good = {
      ...base,
      spread: 0.5,
      confidence: 'low' as const,
      uncertaintyNote: 'Wide divergence between AVM and comp-derived values; treat as indicative.',
    };
    expect(TriangulatedValueSchema.safeParse(good).success).toBe(true);
  });
});
