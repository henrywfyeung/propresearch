// tests/unit/compose.prompt.test.ts
import { buildMessages, version } from '@/prompts/compose';
import { describe, expect, it } from 'vitest';

const input = {
  suburb: 'Mosman',
  subjectAttrs: {
    beds: 3,
    baths: 2,
    parking: 1,
    landArea: 500,
    buildingArea: null,
    propertyType: 'House',
  },
  triangulation: {
    compDerived: 2_500_000,
    low: 2_400_000,
    high: 2_600_000,
    reconciled: 2_500_000,
    confidence: 'high' as const,
    spread: 0.08,
  },
  selectedComps: [
    {
      id: 'A',
      address: 'A St',
      salePrice: 2_400_000,
      adjustedValue: 2_500_000,
      contractDate: '2026-03-01',
      beds: 3,
      baths: 2,
      propertyType: 'House',
      selection: 'fair-value',
      verdict: 'comparable' as const,
      comparison: {
        size: 'Similar 500m² block',
        layout: 'Same 3/2 layout, single storey',
        condition: 'Comparable presentation',
        location: 'Same street precinct',
      },
    },
  ],
  risks: [],
  recentDAs: [],
  suburbStats: null,
  demographics: null,
};

describe('compose prompt', () => {
  it('is at version v1.6', () => {
    expect(version).toBe('v1.6');
  });
  it('builds a system+user pair naming the section and carrying the suburb', () => {
    const msgs = buildMessages('valuation', input);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toContain('valuation');
    expect(msgs[1]?.role).toBe('user');
    expect(msgs[1]?.content).toContain('Mosman');
  });
  it('risks section system message mentions risk register instructions', () => {
    const msgs = buildMessages('risks', input);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toContain('risk register');
    expect(msgs[0]?.content).toContain('data was unavailable');
  });
  it('risks section user message includes the serialised risk register', () => {
    const msgs = buildMessages('risks', { ...input, risks: [] });
    expect(msgs[1]?.content).toContain('Risk register');
  });
  it('planning section system message mentions development activity', () => {
    const msgs = buildMessages('planning', input);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toContain('development activity');
    expect(msgs[0]?.content).toContain('do not invent activity');
  });
  it('planning section user message includes the serialised DA list', () => {
    const msgs = buildMessages('planning', { ...input, recentDAs: [] });
    expect(msgs[1]?.content).toContain('Recent DAs');
  });
  it('market section system message mentions recent sales market context', () => {
    const msgs = buildMessages('market', input);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toContain("suburb's recent sales market");
    expect(msgs[0]?.content).toContain('sample was too small');
  });
  it('market section user message includes the suburb stats JSON', () => {
    const stats = {
      sampleSize: 5,
      medianSalePrice: 2_500_000,
      minSalePrice: 2_000_000,
      maxSalePrice: 3_000_000,
      medianBeds: 3,
      medianBaths: 2,
      mostRecentSaleDate: '2026-05-01',
    };
    const msgs = buildMessages('market', { ...input, suburbStats: stats });
    expect(msgs[1]?.content).toContain('Suburb stats');
    expect(msgs[1]?.content).toContain('2500000');
  });
  it('market section user message includes null stats when unavailable', () => {
    const msgs = buildMessages('market', { ...input, suburbStats: null });
    expect(msgs[1]?.content).toContain('Suburb stats');
    expect(msgs[1]?.content).toContain('null');
  });
  it('market section system message mentions demographic context when available', () => {
    const msgs = buildMessages('market', input);
    expect(msgs[0]?.content).toContain('demographic');
    expect(msgs[0]?.content).toContain('owner-occupier');
    expect(msgs[0]?.content).toContain('weekly');
  });
  it('market section user message includes demographics JSON when provided', () => {
    const demo = {
      sa2Code: '121041688',
      sa2Name: 'Mosman',
      censusYear: 2021,
      population: 11_234,
      medianAge: 42,
      medianHouseholdIncomeWeekly: 2_800,
      medianPersonalIncomeWeekly: 1_500,
      medianRentWeekly: 650,
      medianMortgageMonthly: 3_200,
      avgHouseholdSize: 2.4,
      ownerOccupiedPct: 72.1,
      rentedPct: 22.3,
      ownedWithMortgagePct: 28.5,
      socialHousingPct: 1.2,
      seifaIrsadDecile: 10,
      seifaIrsadScore: 1158,
    };
    const msgs = buildMessages('market', { ...input, demographics: demo });
    expect(msgs[1]?.content).toContain('Demographics');
    expect(msgs[1]?.content).toContain('11234');
    expect(msgs[1]?.content).toContain('Mosman');
  });
  it('market section user message includes null demographics when not available', () => {
    const msgs = buildMessages('market', { ...input, demographics: null });
    expect(msgs[1]?.content).toContain('Demographics');
    expect(msgs[1]?.content).toContain('null');
  });
});
