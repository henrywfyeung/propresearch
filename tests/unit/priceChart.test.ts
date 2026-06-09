import { priceChartSvg } from '@/report/charts/priceChart';
import { describe, expect, it } from 'vitest';

describe('priceChartSvg', () => {
  it('fallback (no verdict): one dot per comp + legend, with the anchor colour', () => {
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
    // 3 comp dots + 2 legend swatches (fair value / anchor).
    expect((svg.match(/<circle /g) ?? []).length).toBe(5);
    expect(svg).toContain('#C99A00'); // anchor colour (dot + legend)
    expect(svg).toContain('estimate'); // reconciled bracket label
    expect(svg).toContain('fair value');
  });

  it('banded: colours dots by verdict, shades the comparable band, draws the bounds', () => {
    const svg = priceChartSvg({
      low: 800_000,
      high: 850_000,
      reconciled: 825_000,
      bands: {
        inferiorCap: 800_000,
        comparableLow: 805_000,
        comparableHigh: 848_000,
        superiorFloor: 855_000,
      },
      comps: [
        { label: 'inf', price: 760_000, selection: 'fair-value', verdict: 'inferior' },
        { label: 'cmp', price: 820_000, selection: 'fair-value', verdict: 'comparable' },
        { label: 'sup', price: 900_000, selection: 'negotiation-anchor', verdict: 'superior' },
      ],
    });
    expect(svg).toContain('#2E8B57'); // superior (green)
    expect(svg).toContain('#9AA3AD'); // inferior (grey)
    expect(svg).toContain('<rect'); // comparable band shading
    expect(svg).toContain('inferior ≤');
    expect(svg).toContain('superior ≥');
    // verdict legend, not the fair-value/anchor fallback.
    expect(svg).toContain('comparable');
    expect(svg).not.toContain('fair value');
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
