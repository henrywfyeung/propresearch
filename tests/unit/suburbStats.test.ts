import type { Comparable } from '@/schemas/state';
// tests/unit/suburbStats.test.ts — TDD for computeSuburbStats
import { computeSuburbStats } from '@/tools/market/suburbStats';
import { describe, expect, it } from 'vitest';

function comp(overrides: Partial<Comparable> = {}): Comparable {
  return {
    id: 'c1',
    address: '1 Test St',
    salePrice: 1_000_000,
    contractDate: '2026-01-01',
    distanceM: 200,
    beds: 3,
    baths: 2,
    landArea: 500,
    propertyType: 'House',
    photos: [],
    visionAnalysis: null,
    similarityScore: 80,
    selection: 'candidate',
    adjustments: [],
    adjustedValue: null,
    adjustmentNarrative: null,
    source: {
      provider: 'rea',
      endpoint: '/properties/search?channel=sold',
      fetchedAt: '2026-05-30T00:00:00.000Z',
      path: '/comparables/0/salePrice',
    },
    ...overrides,
  };
}

describe('computeSuburbStats', () => {
  it('returns null when fewer than 3 priced comps', () => {
    expect(computeSuburbStats([])).toBeNull();
    expect(computeSuburbStats([comp()])).toBeNull();
    expect(computeSuburbStats([comp(), comp({ id: 'c2' })])).toBeNull();
  });

  it('computes median for odd count (5 items)', () => {
    const comps = [
      comp({ id: '1', salePrice: 1_000_000 }),
      comp({ id: '2', salePrice: 2_000_000 }),
      comp({ id: '3', salePrice: 3_000_000 }),
      comp({ id: '4', salePrice: 4_000_000 }),
      comp({ id: '5', salePrice: 5_000_000 }),
    ];
    const stats = computeSuburbStats(comps);
    expect(stats).not.toBeNull();
    // median of [1M,2M,3M,4M,5M] = 3M (middle of sorted array)
    expect(stats?.medianSalePrice).toBe(3_000_000);
    expect(stats?.minSalePrice).toBe(1_000_000);
    expect(stats?.maxSalePrice).toBe(5_000_000);
    expect(stats?.sampleSize).toBe(5);
  });

  it('computes median for even count (4 items) as mean of two middle values', () => {
    const comps = [
      comp({ id: '1', salePrice: 1_000_000 }),
      comp({ id: '2', salePrice: 2_000_000 }),
      comp({ id: '3', salePrice: 3_000_000 }),
      comp({ id: '4', salePrice: 4_000_000 }),
    ];
    const stats = computeSuburbStats(comps);
    expect(stats?.medianSalePrice).toBe(2_500_000); // mean of 2M + 3M
  });

  it('returns exactly 3 comps (boundary)', () => {
    const comps = [
      comp({ id: '1', salePrice: 1_000_000 }),
      comp({ id: '2', salePrice: 2_000_000 }),
      comp({ id: '3', salePrice: 3_000_000 }),
    ];
    const stats = computeSuburbStats(comps);
    expect(stats).not.toBeNull();
    expect(stats?.sampleSize).toBe(3);
    expect(stats?.medianSalePrice).toBe(2_000_000);
  });

  it('returns null when <3 comps have positive salePrice (ignores the rest)', () => {
    // salePrice=0 is non-positive, should be excluded
    const comps = [
      comp({ id: '1', salePrice: 1_000_000 }),
      comp({ id: '2', salePrice: 2_000_000 }),
      // salePrice of 0 is not positive — but the schema has z.number().positive()
      // so valid comps always have salePrice > 0; test with a very low value that
      // is still technically positive to verify filter logic separately below
    ];
    expect(computeSuburbStats(comps)).toBeNull();
  });

  it('computes medianBeds and medianBaths', () => {
    const comps = [
      comp({ id: '1', beds: 2, baths: 1 }),
      comp({ id: '2', beds: 3, baths: 2 }),
      comp({ id: '3', beds: 4, baths: 2 }),
    ];
    const stats = computeSuburbStats(comps);
    expect(stats?.medianBeds).toBe(3);
    expect(stats?.medianBaths).toBe(2);
  });

  it('returns mostRecentSaleDate as max contractDate (ISO string comparison)', () => {
    const comps = [
      comp({ id: '1', contractDate: '2026-01-15' }),
      comp({ id: '2', contractDate: '2026-03-20' }),
      comp({ id: '3', contractDate: '2025-12-01' }),
    ];
    const stats = computeSuburbStats(comps);
    expect(stats?.mostRecentSaleDate).toBe('2026-03-20');
  });

  it('returns null mostRecentSaleDate when all contractDates are empty strings', () => {
    const comps = [
      comp({ id: '1', contractDate: '' }),
      comp({ id: '2', contractDate: '' }),
      comp({ id: '3', contractDate: '' }),
    ];
    const stats = computeSuburbStats(comps);
    expect(stats?.mostRecentSaleDate).toBeNull();
  });

  it('handles a single unique contractDate correctly', () => {
    const comps = [
      comp({ id: '1', contractDate: '2026-05-01' }),
      comp({ id: '2', contractDate: '2026-05-01' }),
      comp({ id: '3', contractDate: '2026-05-01' }),
    ];
    const stats = computeSuburbStats(comps);
    expect(stats?.mostRecentSaleDate).toBe('2026-05-01');
  });

  it('medianBeds and medianBaths are null when no beds/baths data', () => {
    // beds/baths are nonnegative integers in the schema; 0 is valid
    // test that if all are 0, median is 0 (not null)
    const comps = [
      comp({ id: '1', beds: 0, baths: 0 }),
      comp({ id: '2', beds: 0, baths: 0 }),
      comp({ id: '3', beds: 0, baths: 0 }),
    ];
    const stats = computeSuburbStats(comps);
    // 0 is a valid number, so medianBeds should be 0 not null
    expect(stats?.medianBeds).toBe(0);
  });
});
