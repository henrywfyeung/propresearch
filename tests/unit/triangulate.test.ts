import { triangulate } from '@/agents/nodes/07_triangulate';
import { TriangulatedValueSchema } from '@/schemas/state';
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
