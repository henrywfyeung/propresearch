import { formatValue, renderClaim } from '@/report/renderClaim';
import type { ClaimBlock } from '@/schemas/claims';
import { describe, expect, it } from 'vitest';

const SOURCE = {
  provider: 'derived' as const,
  endpoint: 'test',
  fetchedAt: '2026-05-01T00:00:00.000Z',
  path: '/triangulation/reconciled',
};

describe('formatValue', () => {
  it('formats AUD currency with no decimals', () => {
    expect(formatValue(1_200_000, 'currency-aud')).toContain('1,200,000');
    expect(formatValue(1_200_000, 'currency-aud')).toMatch(/^\$/);
  });
  it('formats percent to 1 d.p.', () => {
    expect(formatValue(7.25, 'percent')).toBe('7.3%');
  });
  it('formats distance in m / km', () => {
    expect(formatValue(450, 'distance-m')).toMatch(/450.m/);
    expect(formatValue(1500, 'distance-m')).toMatch(/1\.5.km/);
  });
  it('formats duration with singular/plural day(s)', () => {
    expect(formatValue(1, 'duration-days')).toMatch(/1.day$/);
    expect(formatValue(30, 'duration-days')).toMatch(/30.days$/);
  });
});

describe('renderClaim', () => {
  it('passes text blocks through unchanged', () => {
    const b: ClaimBlock = { type: 'text', text: 'The property presents well.' };
    expect(renderClaim(b)).toBe('The property presents well.');
  });

  it('substitutes {{v}} in a claim block', () => {
    const b: ClaimBlock = {
      type: 'claim',
      text: 'Median price rose {{v}} YoY',
      value: 6.4,
      format: 'percent',
      sourceRef: SOURCE,
    };
    expect(renderClaim(b)).toBe('Median price rose 6.4% YoY');
  });

  it('substitutes {{lo}} and {{hi}} in a range block', () => {
    const b: ClaimBlock = {
      type: 'range',
      text: 'Estimated value {{lo}}–{{hi}}',
      low: 1_200_000,
      high: 1_350_000,
      format: 'currency-aud',
      sourceRef: SOURCE,
    };
    const out = renderClaim(b);
    expect(out).toContain('1,200,000');
    expect(out).toContain('1,350,000');
    expect(out).toContain('–');
  });
});
