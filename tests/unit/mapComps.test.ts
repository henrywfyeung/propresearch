// tests/unit/mapComps.test.ts — selectedMapComps: which comps get a map pin +
// legend row, in what order. Keeps the map pins and the price legend in sync.

import { MAX_MAP_COMPS, selectedMapComps } from '@/report/mapComps';
import type { Comparable } from '@/schemas/state';
import { describe, expect, it } from 'vitest';

function comp(over: Partial<Comparable>): Comparable {
  return {
    id: Math.random().toString(36).slice(2),
    address: '1 Test St, Mosman NSW 2088',
    salePrice: 1_000_000,
    contractDate: '2026-05-01',
    distanceM: 200,
    lat: -33.82,
    lng: 151.24,
    beds: 2,
    baths: 2,
    landArea: null,
    propertyType: 'ApartmentUnitFlat',
    photos: [],
    listingUrl: null,
    visionAnalysis: null,
    similarityScore: 80,
    selection: 'fair-value',
    adjustments: [],
    adjustedValue: null,
    adjustmentNarrative: null,
    verdict: null,
    comparison: null,
    source: {
      provider: 'rea',
      endpoint: '/x',
      fetchedAt: '2026-05-01T00:00:00.000Z',
      path: '/comparables/0/salePrice',
    },
    ...over,
  };
}

describe('selectedMapComps', () => {
  it('keeps only fair-value and negotiation-anchor comps', () => {
    const comps = [
      comp({ id: 'a', selection: 'fair-value' }),
      comp({ id: 'b', selection: 'negotiation-anchor' }),
      comp({ id: 'c', selection: 'rejected' }),
      comp({ id: 'd', selection: 'candidate' }),
    ];
    expect(selectedMapComps(comps).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('drops comps without coordinates', () => {
    const comps = [comp({ id: 'a' }), comp({ id: 'b', lat: null }), comp({ id: 'c', lng: null })];
    expect(selectedMapComps(comps).map((c) => c.id)).toEqual(['a']);
  });

  it('preserves array order (so pin numbers match legend numbers)', () => {
    const comps = [comp({ id: 'x' }), comp({ id: 'y' }), comp({ id: 'z' })];
    expect(selectedMapComps(comps).map((c) => c.id)).toEqual(['x', 'y', 'z']);
  });

  it(`caps the count at ${MAX_MAP_COMPS}`, () => {
    const comps = Array.from({ length: 20 }, (_, i) => comp({ id: `c${i}` }));
    expect(selectedMapComps(comps)).toHaveLength(MAX_MAP_COMPS);
  });
});
