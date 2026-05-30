// tests/unit/reasonAndSelect.prompt.test.ts
import { buildMessages, version } from '@/prompts/reasonAndSelect';
import { describe, expect, it } from 'vitest';

const input = {
  subject: {
    suburb: 'Mosman',
    attrs: {
      beds: 3,
      baths: 2,
      parking: 1,
      landArea: 500,
      buildingArea: null,
      propertyType: 'House',
    },
  },
  comps: [
    {
      id: 'A',
      address: 'A St',
      salePrice: 2_000_000,
      contractDate: '2026-03-01',
      distanceM: 100,
      beds: 3,
      baths: 2,
      landArea: 480,
      propertyType: 'House',
      similarityScore: 90,
    },
  ],
};

describe('reasonAndSelect prompt', () => {
  it('has a non-empty version', () => {
    expect(version.length).toBeGreaterThan(0);
  });
  it('builds a system+user pair carrying the suburb and every comp id', () => {
    const msgs = buildMessages(input);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[1]?.role).toBe('user');
    expect(msgs[1]?.content).toContain('Mosman');
    expect(msgs[1]?.content).toContain('"A"');
  });
});
