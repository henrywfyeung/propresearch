import { computeValuationBands, triangulate } from '@/agents/nodes/07_triangulate';
import { type CompVerdict, TriangulatedValueSchema } from '@/schemas/state';
import { describe, expect, it } from 'vitest';
// tests/unit/triangulate.test.ts
import { graphState, sampleComparable } from '../fixtures/comps';

const fv = (id: string, adjustedValue: number, similarityScore = 80) =>
  sampleComparable(id, { selection: 'fair-value', adjustedValue, similarityScore });

describe('triangulate', () => {
  it('produces a schema-valid comp-derived value from the fair-value comps', () => {
    const state = graphState({
      comparables: [
        fv('a', 2_400_000),
        fv('b', 2_500_000),
        fv('c', 2_600_000),
        sampleComparable('z', { selection: 'rejected' }),
      ],
    });
    const out = triangulate(state);
    expect(out.triangulation).toBeDefined();
    expect(() => TriangulatedValueSchema.parse(out.triangulation)).not.toThrow();
    expect(out.triangulation?.compIds).toEqual(['a', 'b', 'c']);
    expect(out.triangulation?.low).toBe(2_400_000);
    expect(out.triangulation?.high).toBe(2_600_000);
    expect(out.triangulation?.reconciled).toBe(out.triangulation?.compDerived);
    expect(out.triangulation?.confidence).toBe('high'); // tight cluster, >=3 comps
  });

  it('weights toward the higher-similarity comp', () => {
    const state = graphState({ comparables: [fv('a', 2_000_000, 100), fv('b', 3_000_000, 10)] });
    const out = triangulate(state);
    // plain mean = 2.5M; weighted toward 'a' (sim 100) -> below 2.5M
    expect(out.triangulation?.compDerived).toBeLessThan(2_500_000);
  });

  it('wide spread -> low confidence + uncertaintyNote', () => {
    const state = graphState({ comparables: [fv('a', 2_000_000), fv('b', 3_200_000)] });
    const out = triangulate(state);
    expect(out.triangulation?.confidence).toBe('low');
    expect(out.triangulation?.uncertaintyNote).not.toBeNull();
    expect(() => TriangulatedValueSchema.parse(out.triangulation)).not.toThrow();
  });

  it('errors in-band when there are no fair-value comps', () => {
    const out = triangulate(
      graphState({ comparables: [sampleComparable('z', { selection: 'rejected' })] }),
    );
    expect(out.errors?.[0]?.code).toBe('PARTIAL_DATA');
    expect(out.triangulation).toBeUndefined();
  });
});

describe('computeValuationBands', () => {
  const v = (id: string, salePrice: number, verdict: CompVerdict) =>
    sampleComparable(id, { salePrice, verdict });

  it('derives the inferior cap, comparable band and superior floor from raw sold prices', () => {
    const bands = computeValuationBands([
      v('i1', 760_000, 'inferior'),
      v('i2', 800_000, 'inferior'), // highest inferior -> the cap
      v('c1', 805_000, 'comparable'),
      v('c2', 848_000, 'comparable'),
      v('s1', 855_000, 'superior'), // lowest superior -> the floor
      v('s2', 905_000, 'superior'),
    ]);
    expect(bands).toEqual({
      inferiorCap: 800_000,
      comparableLow: 805_000,
      comparableHigh: 848_000,
      superiorFloor: 855_000,
      counts: { inferior: 2, comparable: 2, superior: 1 + 1 },
    });
  });

  it('uses the WHOLE pool incl. rejected comps, and leaves missing verdicts null', () => {
    const bands = computeValuationBands([
      sampleComparable('r', { selection: 'rejected', salePrice: 700_000, verdict: 'inferior' }),
      v('c1', 820_000, 'comparable'),
    ]);
    expect(bands?.inferiorCap).toBe(700_000); // rejected-for-selection still informs the floor
    expect(bands?.superiorFloor).toBeNull();
    expect(bands?.counts).toEqual({ inferior: 1, comparable: 1, superior: 0 });
  });

  it('returns null when no comp carries a verdict (degraded run)', () => {
    expect(computeValuationBands([sampleComparable('a'), sampleComparable('b')])).toBeNull();
  });

  it('triangulate attaches the bands and references them in the narrative', () => {
    const state = graphState({
      comparables: [
        sampleComparable('a', {
          selection: 'fair-value',
          adjustedValue: 820_000,
          verdict: 'comparable',
          salePrice: 815_000,
        }),
        sampleComparable('b', {
          selection: 'fair-value',
          adjustedValue: 830_000,
          verdict: 'comparable',
          salePrice: 845_000,
        }),
        sampleComparable('z', { selection: 'rejected', verdict: 'superior', salePrice: 900_000 }),
      ],
    });
    const out = triangulate(state);
    expect(out.triangulation?.bands?.superiorFloor).toBe(900_000);
    expect(out.triangulation?.narrative).toContain('superior sales start near');
    expect(() => TriangulatedValueSchema.parse(out.triangulation)).not.toThrow();
  });
});
