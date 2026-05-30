// tests/unit/triangulation.test.ts
import { TriangulatedValueSchema } from '@/schemas/state';
import { describe, expect, it } from 'vitest';

const base = {
  compDerived: 2_500_000,
  low: 2_300_000,
  high: 2_700_000,
  reconciled: 2_500_000,
  confidence: 'high' as const,
  spread: 0.16,
  compIds: ['a', 'b', 'c'],
  uncertaintyNote: null,
  narrative:
    'Derived from 3 fair-value comparables; weighted estimate around 2.5M with a tight range.',
};

describe('TriangulatedValueSchema (v2 comp-derived)', () => {
  it('accepts a valid comp-derived value', () => {
    expect(TriangulatedValueSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a high spread (>0.25) with confidence high and no note [R44]', () => {
    expect(TriangulatedValueSchema.safeParse({ ...base, spread: 0.5 }).success).toBe(false);
  });

  it('accepts a high spread when confidence=low and an uncertaintyNote is present [R44]', () => {
    const good = {
      ...base,
      spread: 0.5,
      confidence: 'low' as const,
      uncertaintyNote: 'The comparables span a wide range; treat the estimate as indicative.',
    };
    expect(TriangulatedValueSchema.safeParse(good).success).toBe(true);
  });
});
