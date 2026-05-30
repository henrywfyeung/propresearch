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
    },
  ],
};

describe('compose prompt', () => {
  it('has a non-empty version', () => {
    expect(version.length).toBeGreaterThan(0);
  });
  it('builds a system+user pair naming the section and carrying the suburb', () => {
    const msgs = buildMessages('valuation', input);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toContain('valuation');
    expect(msgs[1]?.role).toBe('user');
    expect(msgs[1]?.content).toContain('Mosman');
  });
});
