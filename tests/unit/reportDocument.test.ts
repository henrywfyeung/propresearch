import { renderReportHtml } from '@/report/render';
import type { ReportData } from '@/report/template/ReportDocument';
import { describe, expect, it } from 'vitest';

const data: ReportData = {
  address: '12 Awaba Street, Mosman',
  suburb: 'Mosman',
  state: 'NSW',
  postcode: '2088',
  subject: {
    beds: 4,
    baths: 2,
    parking: 2,
    landArea: 540,
    buildingArea: 210,
    propertyType: 'House',
  },
  triangulation: {
    low: 4_200_000,
    high: 4_800_000,
    reconciled: 4_500_000,
    confidence: 'high',
    uncertaintyNote: null,
  },
  comparables: [],
  prose: {
    summary: [{ type: 'text', text: 'Summary narrative for the dossier goes here.' }],
    valuation: [
      {
        type: 'range',
        text: 'Estimated value {{lo}}-{{hi}}',
        low: 4_200_000,
        high: 4_800_000,
        format: 'currency-aud',
        sourceRef: {
          provider: 'derived',
          endpoint: 'node:triangulate',
          fetchedAt: '2026-05-31T00:00:00.000Z',
          path: '/triangulation/reconciled',
        },
      },
    ],
  },
  generatedAt: '2026-05-31T00:00:00.000Z',
};

describe('renderReportHtml', () => {
  it('renders a standalone HTML doc with address, sections, and the value range', () => {
    const html = renderReportHtml(data);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('12 Awaba Street, Mosman');
    expect(html).toContain('Summary');
    expect(html).toContain('Valuation');
    expect(html).toContain('Comparable sales');
    expect(html).toMatch(/4,200,000/);
    expect(html).toMatch(/4,800,000/);
    expect(html).toContain('high confidence');
  });

  it('omits the value callout when triangulation is null', () => {
    const html = renderReportHtml({ ...data, triangulation: null });
    expect(html).not.toContain('confidence');
  });
});
