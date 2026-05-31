import { priceChartSvg } from '@/report/charts/priceChart';
import { describe, expect, it } from 'vitest';

describe('priceChartSvg', () => {
  it('renders an svg with a dot per comp, the value band, and the anchor colour', () => {
    const svg = priceChartSvg({
      low: 2_400_000,
      high: 2_600_000,
      reconciled: 2_500_000,
      comps: [
        { label: 'A', price: 2_450_000, selection: 'fair-value' },
        { label: 'B', price: 2_550_000, selection: 'fair-value' },
        { label: 'C', price: 2_900_000, selection: 'negotiation-anchor' },
      ],
    });
    expect(svg).toContain('<svg');
    expect((svg.match(/<circle /g) ?? []).length).toBe(3);
    expect(svg).toContain('<rect'); // value-range band
    expect(svg).toContain('#C99A00'); // anchor dot colour
  });

  it('handles a single comp / zero span without producing NaN', () => {
    const svg = priceChartSvg({
      low: 2_000_000,
      high: 2_000_000,
      reconciled: 2_000_000,
      comps: [{ label: 'A', price: 2_000_000, selection: 'fair-value' }],
    });
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('NaN');
  });
});
