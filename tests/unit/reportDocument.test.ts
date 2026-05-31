import { renderReportHtml } from '@/report/render';
import type { ReportData } from '@/report/template/ReportDocument';
import type { RecentDA, RiskFlag } from '@/schemas/state';
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
  risks: [],
  recentDAs: [],
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

describe('Risk register rendering', () => {
  const floodFlag: RiskFlag = {
    category: 'flood',
    severity: 'high',
    description: 'Property is within a high-probability flood planning area.',
    sourceRef: null,
    evidence: null,
    dataAvailable: true,
  };

  const bushfireUnavailable: RiskFlag = {
    category: 'bushfire',
    severity: 'informational',
    description: 'Bushfire prone land data could not be retrieved.',
    sourceRef: null,
    evidence: null,
    dataAvailable: false,
  };

  it('renders Risk register heading', () => {
    const html = renderReportHtml({ ...data, risks: [floodFlag] });
    expect(html).toContain('Risk register');
  });

  it('renders category, severity chip, and description for a dataAvailable flag', () => {
    const html = renderReportHtml({ ...data, risks: [floodFlag] });
    // category (capitalised by CSS text-transform, but the text node itself is lowercase)
    expect(html).toContain('flood');
    // severity chip label
    expect(html).toContain('high');
    // description
    expect(html).toContain('Property is within a high-probability flood planning area.');
    // severity chip CSS class
    expect(html).toContain('sev-high');
    // must NOT show the unavailable treatment for a data-available flag
    expect(html).not.toContain('data unavailable');
  });

  it('renders a data-unavailable treatment and does not imply the property is risk-free', () => {
    const html = renderReportHtml({ ...data, risks: [bushfireUnavailable] });
    // description still shown
    expect(html).toContain('Bushfire prone land data could not be retrieved.');
    // chip label is "data unavailable" not the severity
    expect(html).toContain('data unavailable');
    // row carries the unavailable CSS class
    expect(html).toContain('unavailable');
  });

  it('renders prose.risks paragraphs above the flag list', () => {
    const riskProse: ReportData['prose'] = {
      ...data.prose,
      risks: [{ type: 'text', text: 'Two risk categories were assessed for this property.' }],
    };
    const html = renderReportHtml({ ...data, risks: [floodFlag], prose: riskProse });
    expect(html).toContain('Two risk categories were assessed for this property.');
    // prose text should appear before the risk row in document order
    const proseIdx = html.indexOf('Two risk categories');
    const rowIdx = html.indexOf('flood');
    expect(proseIdx).toBeLessThan(rowIdx);
  });

  it('renders an empty risk register section when risks array is empty', () => {
    const html = renderReportHtml({ ...data, risks: [] });
    expect(html).toContain('Risk register');
  });
});

describe('Planning activity rendering', () => {
  const daFull: RecentDA = {
    description: 'Demolish existing dwelling and construct two-storey dwelling',
    status: 'Approved',
    category: 'Development Application',
    distanceM: 120,
    lodgedDate: '2026-03-15',
    coverage: 'full',
    sourceRef: {
      provider: 'nsw-planning',
      endpoint: 'onlineDa',
      fetchedAt: '2026-05-31T00:00:00.000Z',
      path: '/market/recentDAs/0',
    },
  };

  const daMeta: RecentDA = {
    description: 'Subdivision of land into three lots',
    status: null,
    category: null,
    distanceM: 340,
    lodgedDate: null,
    coverage: 'metadata-only',
    sourceRef: {
      provider: 'nsw-planning',
      endpoint: 'onlineDa',
      fetchedAt: '2026-05-31T00:00:00.000Z',
      path: '/market/recentDAs/1',
    },
  };

  it('renders Planning activity heading', () => {
    const html = renderReportHtml({ ...data, recentDAs: [daFull] });
    expect(html).toContain('Planning activity');
  });

  it('renders DA description, distance, and status chip', () => {
    const html = renderReportHtml({ ...data, recentDAs: [daFull] });
    expect(html).toContain('Demolish existing dwelling and construct two-storey dwelling');
    expect(html).toContain('120 m');
    expect(html).toContain('Approved');
  });

  it('renders DA with metadata-only coverage and no status', () => {
    const html = renderReportHtml({ ...data, recentDAs: [daMeta] });
    expect(html).toContain('Subdivision of land into three lots');
    expect(html).toContain('340 m');
  });

  it('renders prose.planning paragraphs above the DA list', () => {
    const planningProse: ReportData['prose'] = {
      ...data.prose,
      planning: [
        {
          type: 'text',
          text: 'Three development applications were lodged nearby in the past 12 months.',
        },
      ],
    };
    const html = renderReportHtml({ ...data, recentDAs: [daFull], prose: planningProse });
    expect(html).toContain('Three development applications were lodged nearby');
    // prose should appear before the DA row
    const proseIdx = html.indexOf('Three development applications were lodged nearby');
    const rowIdx = html.indexOf('Demolish existing dwelling');
    expect(proseIdx).toBeLessThan(rowIdx);
  });

  it('renders empty-state message when recentDAs is empty', () => {
    const html = renderReportHtml({ ...data, recentDAs: [] });
    expect(html).toContain('Planning activity');
    expect(html).toContain('No recent development applications found nearby');
    expect(html).toContain('unavailable');
  });

  it('caps display at 10 DAs and shows overflow count', () => {
    const manyDAs: RecentDA[] = Array.from({ length: 13 }, (_, i) => ({
      description: `DA number ${i + 1}`,
      status: 'Pending',
      category: null,
      distanceM: 50 + i * 20,
      lodgedDate: '2026-01-01',
      coverage: 'full' as const,
      sourceRef: {
        provider: 'nsw-planning' as const,
        endpoint: 'onlineDa',
        fetchedAt: '2026-05-31T00:00:00.000Z',
        path: `/market/recentDAs/${i}`,
      },
    }));
    const html = renderReportHtml({ ...data, recentDAs: manyDAs });
    // Only first 10 shown
    expect(html).toContain('DA number 1');
    expect(html).toContain('DA number 10');
    expect(html).not.toContain('DA number 11');
    // Overflow line
    expect(html).toContain('3 more');
  });
});
