// tests/unit/salesTrendChart.test.ts — recent-sales-over-time SVG scatter.

import { salesTrendChartSvg } from '@/report/charts/salesTrendChart';
import { describe, expect, it } from 'vitest';

const comps = [
  { price: 1_200_000, date: '2026-01-15', verdict: 'inferior' as const },
  { price: 1_400_000, date: '2026-04-20', verdict: 'superior' as const },
  { price: 1_320_000, date: '2026-03-10', verdict: 'comparable' as const },
];

describe('salesTrendChartSvg', () => {
  it('renders an SVG scatter with the estimate line, month labels and verdict colours', () => {
    const svg = salesTrendChartSvg({ comps, reconciled: 1_345_000 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('estimate');
    expect(svg).toContain('Jan 2026');
    expect(svg).toContain('Apr 2026');
    expect(svg).toContain('#2E8B57'); // superior green
    expect(svg).toContain('#9AA3AD'); // inferior grey
    // 3 data dots + 3 legend dots
    expect((svg.match(/<circle/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('returns an empty string when fewer than two dated sales exist (caller omits it)', () => {
    expect(salesTrendChartSvg({ comps: [comps[0]!] })).toBe('');
    expect(salesTrendChartSvg({ comps: [] })).toBe('');
  });

  it('ignores comps with unparseable dates but still renders from the valid ones', () => {
    const svg = salesTrendChartSvg({
      comps: [...comps, { price: 9, date: 'not-a-date', verdict: null }],
      reconciled: null,
    });
    expect(svg.startsWith('<svg')).toBe(true);
  });
});
