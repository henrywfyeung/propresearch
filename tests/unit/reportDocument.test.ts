import { renderReportHtml } from '@/report/render';
import type { ReportData } from '@/report/template/ReportDocument';
import type { Comparable, RecentDA, RiskFlag } from '@/schemas/state';
import type { SubjectVision } from '@/schemas/vision';
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
  suburbStats: null,
  demographics: null,
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
  staticMapDataUrl: null,
  mapHref: null,
  photos: [],
  floorplans: [],
  subjectVision: null,
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

describe('Suburb market rendering', () => {
  const sampleStats = {
    sampleSize: 8,
    medianSalePrice: 2_500_000,
    minSalePrice: 2_000_000,
    maxSalePrice: 3_200_000,
    medianBeds: 3,
    medianBaths: 2,
    mostRecentSaleDate: '2026-05-01',
  };

  it('renders Suburb market heading', () => {
    const html = renderReportHtml({ ...data, suburbStats: sampleStats });
    expect(html).toContain('Suburb market');
  });

  it('renders the stats grid with sample size and median price', () => {
    const html = renderReportHtml({ ...data, suburbStats: sampleStats });
    expect(html).toContain('Sample size');
    expect(html).toContain('8');
    expect(html).toContain('Median sale price');
    // formatted as AUD — look for some part of the formatted value
    expect(html).toMatch(/2,500,000/);
  });

  it('renders price range min and max', () => {
    const html = renderReportHtml({ ...data, suburbStats: sampleStats });
    expect(html).toContain('Price range');
    expect(html).toMatch(/2,000,000/);
    expect(html).toMatch(/3,200,000/);
  });

  it('renders median beds and baths', () => {
    const html = renderReportHtml({ ...data, suburbStats: sampleStats });
    expect(html).toContain('Median beds');
    expect(html).toContain('Median baths');
  });

  it('renders most recent sale date', () => {
    const html = renderReportHtml({ ...data, suburbStats: sampleStats });
    expect(html).toContain('Most recent sale');
    // date formatted via formatValue — "1 May 2026" or similar
    expect(html).toContain('2026');
  });

  it('renders prose.market paragraphs above the stats grid', () => {
    const marketProse: ReportData['prose'] = {
      ...data.prose,
      market: [{ type: 'text', text: 'Recent comparable sales indicate a competitive market.' }],
    };
    const html = renderReportHtml({ ...data, suburbStats: sampleStats, prose: marketProse });
    expect(html).toContain('Recent comparable sales indicate a competitive market.');
    // prose should appear before the stats grid
    const proseIdx = html.indexOf('Recent comparable sales indicate');
    const gridIdx = html.indexOf('Sample size');
    expect(proseIdx).toBeLessThan(gridIdx);
  });

  it('renders the muted unavailable note when suburbStats is null', () => {
    const html = renderReportHtml({ ...data, suburbStats: null });
    expect(html).toContain('Suburb market');
    expect(html).toContain('Not enough recent comparable sales to summarise the suburb market.');
    expect(html).not.toContain('Sample size');
  });

  it('market section appears after comparables and before risk register', () => {
    const html = renderReportHtml({ ...data, suburbStats: sampleStats });
    const marketIdx = html.indexOf('Suburb market');
    const comparablesIdx = html.indexOf('Comparable sales');
    const riskIdx = html.indexOf('Risk register');
    expect(comparablesIdx).toBeLessThan(marketIdx);
    expect(marketIdx).toBeLessThan(riskIdx);
  });
});

describe('Demographics block rendering', () => {
  const sampleDemographics = {
    sa2Code: '121041688',
    sa2Name: 'Mosman',
    censusYear: 2021 as const,
    population: 11_234,
    medianAge: 42,
    medianHouseholdIncomeWeekly: 2_800,
    medianPersonalIncomeWeekly: 1_500,
    medianRentWeekly: 650,
    medianMortgageMonthly: 3_200,
    avgHouseholdSize: 2.4,
    ownerOccupiedPct: 72.1,
    rentedPct: 22.3,
  };

  it('renders the demographics label with SA2 name and census year when demographics is non-null', () => {
    const html = renderReportHtml({ ...data, demographics: sampleDemographics });
    expect(html).toContain('Mosman');
    expect(html).toContain('2021 Census');
  });

  it('renders population, median age, household income, owner-occupied %, and median rent', () => {
    const html = renderReportHtml({ ...data, demographics: sampleDemographics });
    expect(html).toContain('Population');
    expect(html).toContain('11'); // part of 11,234
    expect(html).toContain('Median age');
    expect(html).toContain('42');
    expect(html).toContain('Median household income');
    expect(html).toContain('Owner-occupied');
    expect(html).toContain('72.1%');
    expect(html).toContain('Median rent');
    expect(html).toContain('/wk');
  });

  it('omits the demographics block when demographics is null', () => {
    const html = renderReportHtml({ ...data, demographics: null });
    expect(html).not.toContain('2021 Census');
    // The demographics label text must not appear (CSS stays in <style>; content DOM won't have it)
    expect(html).not.toContain('SA2 Demographics');
  });

  it('renders demographics block inside the Suburb market section', () => {
    const html = renderReportHtml({ ...data, demographics: sampleDemographics });
    const marketIdx = html.indexOf('Suburb market');
    const demoIdx = html.indexOf('2021 Census');
    const riskIdx = html.indexOf('Risk register');
    expect(marketIdx).toBeLessThan(demoIdx);
    expect(demoIdx).toBeLessThan(riskIdx);
  });

  it('renders gracefully when all nullable census fields are null', () => {
    const partial = {
      sa2Code: '121041688',
      sa2Name: 'Mosman',
      censusYear: 2021 as const,
      population: null,
      medianAge: null,
      medianHouseholdIncomeWeekly: null,
      medianPersonalIncomeWeekly: null,
      medianRentWeekly: null,
      medianMortgageMonthly: null,
      avgHouseholdSize: null,
      ownerOccupiedPct: null,
      rentedPct: null,
    };
    // Should not throw, and SA2 Demographics label should not render (no cells)
    expect(() => renderReportHtml({ ...data, demographics: partial })).not.toThrow();
  });
});

describe('Location map rendering', () => {
  const MAP_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('renders an <img> with the data URL when staticMapDataUrl is provided', () => {
    const html = renderReportHtml({ ...data, staticMapDataUrl: MAP_DATA_URL });
    expect(html).toContain('<img');
    expect(html).toContain(MAP_DATA_URL);
  });

  it('renders the Location section heading when a map is provided', () => {
    const html = renderReportHtml({ ...data, staticMapDataUrl: MAP_DATA_URL });
    expect(html).toContain('Location');
  });

  it('renders no map <img> when staticMapDataUrl is null', () => {
    const html = renderReportHtml({ ...data, staticMapDataUrl: null });
    // Should not contain any data URL img
    expect(html).not.toContain('data:image/png;base64,');
  });

  it('wraps the map image in a link to the interactive map when mapHref is set', () => {
    const href = 'https://www.google.com/maps/search/?api=1&query=-33.83,151.23';
    const html = renderReportHtml({ ...data, staticMapDataUrl: MAP_DATA_URL, mapHref: href });
    // & is HTML-escaped to &amp; in attribute values — assert on the un-escaped prefix.
    expect(html).toContain('https://www.google.com/maps/search/?api=1');
    expect(html).toContain('query=-33.83,151.23');
    // the rendered link wrapper (not the CSS rule) opens before the map image
    const linkIdx = html.indexOf('class="location-map-link"');
    const imgIdx = html.indexOf(MAP_DATA_URL);
    expect(linkIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeLessThan(imgIdx);
  });

  it('renders the map image without an anchor when mapHref is null', () => {
    const html = renderReportHtml({ ...data, staticMapDataUrl: MAP_DATA_URL, mapHref: null });
    expect(html).toContain(MAP_DATA_URL);
    expect(html).not.toContain('class="location-map-link"');
    expect(html).not.toContain('google.com/maps');
  });

  it('location section appears between subject and valuation when present', () => {
    const html = renderReportHtml({ ...data, staticMapDataUrl: MAP_DATA_URL });
    const subjectIdx = html.indexOf('Subject property');
    const locationIdx = html.indexOf('Location');
    const valuationIdx = html.indexOf('Valuation');
    expect(subjectIdx).toBeLessThan(locationIdx);
    expect(locationIdx).toBeLessThan(valuationIdx);
  });
});

describe('Visual inspection rendering', () => {
  const PHOTO_URL = 'https://example.com/photo1.jpg';
  const PHOTO_URL_2 = 'https://example.com/photo2.jpg';
  const FLOORPLAN_URL = 'data:image/jpeg;base64,/9j/floorplan==';
  const FLOORPLAN_URL_2 = 'data:image/jpeg;base64,/9j/floorplan2==';

  const fullVision: SubjectVision = {
    condition: 'good',
    staging: 'professionally-staged',
    presentationFactors: ['Fresh paint', 'Updated kitchen'],
    redFlags: ['Staining on ceiling'],
    comment:
      'The property presents well with a contemporary renovation throughout the main living areas.',
  };

  it('renders the section heading, an img with the photo src, condition, and comment', () => {
    const html = renderReportHtml({ ...data, photos: [PHOTO_URL], subjectVision: fullVision });
    expect(html).toContain('Property condition &amp; visual inspection');
    expect(html).toContain(PHOTO_URL);
    expect(html).toContain('good');
    expect(html).toContain(
      'The property presents well with a contemporary renovation throughout the main living areas.',
    );
  });

  it('renders a red flag with danger styling', () => {
    const html = renderReportHtml({ ...data, photos: [PHOTO_URL], subjectVision: fullVision });
    expect(html).toContain('Staining on ceiling');
    expect(html).toContain('red-flags');
  });

  it('renders presentation factors when present', () => {
    const html = renderReportHtml({ ...data, photos: [PHOTO_URL], subjectVision: fullVision });
    expect(html).toContain('Fresh paint');
    expect(html).toContain('Updated kitchen');
  });

  it('omits the whole section when photos is empty AND floorplans is empty AND subjectVision is null', () => {
    const html = renderReportHtml({ ...data, photos: [], floorplans: [], subjectVision: null });
    expect(html).not.toContain('Property condition');
    expect(html).not.toContain('visual inspection');
  });

  it('renders photo grid + unavailable note when photos exist but vision is null', () => {
    const html = renderReportHtml({
      ...data,
      photos: [PHOTO_URL, PHOTO_URL_2],
      subjectVision: null,
    });
    expect(html).toContain('Property condition');
    expect(html).toContain(PHOTO_URL);
    expect(html).toContain(PHOTO_URL_2);
    expect(html).toContain('Automated visual inspection unavailable.');
    // No condition chip element (CSS class exists in <style> but no element with that class)
    expect(html).not.toContain('class="condition-chip');
  });

  it('caps photos at 6', () => {
    const manyPhotos = Array.from({ length: 10 }, (_, i) => `https://example.com/p${i}.jpg`);
    const html = renderReportHtml({ ...data, photos: manyPhotos, subjectVision: null });
    // Only first 6 should appear
    for (let i = 0; i < 6; i++) {
      expect(html).toContain(`https://example.com/p${i}.jpg`);
    }
    expect(html).not.toContain('https://example.com/p6.jpg');
  });

  it('condition chip class reflects the condition enum (poor → danger, excellent → positive)', () => {
    const poorVision: SubjectVision = { ...fullVision, condition: 'poor' };
    const excellentVision: SubjectVision = { ...fullVision, condition: 'excellent' };
    const htmlPoor = renderReportHtml({ ...data, photos: [PHOTO_URL], subjectVision: poorVision });
    const htmlExcellent = renderReportHtml({
      ...data,
      photos: [PHOTO_URL],
      subjectVision: excellentVision,
    });
    expect(htmlPoor).toContain('danger');
    expect(htmlExcellent).toContain('positive');
  });

  it('visual inspection section appears after location map and before valuation', () => {
    const MAP_DATA_URL =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const html = renderReportHtml({
      ...data,
      staticMapDataUrl: MAP_DATA_URL,
      photos: [PHOTO_URL],
      subjectVision: fullVision,
    });
    const locationIdx = html.indexOf('Location');
    const inspectionIdx = html.indexOf('Property condition');
    const valuationIdx = html.indexOf('Valuation');
    expect(locationIdx).toBeLessThan(inspectionIdx);
    expect(inspectionIdx).toBeLessThan(valuationIdx);
  });

  it('renders a distinct Floor plan block when floorplans is non-empty', () => {
    const html = renderReportHtml({
      ...data,
      photos: [PHOTO_URL],
      floorplans: [FLOORPLAN_URL],
      subjectVision: null,
    });
    // Floor plan label
    expect(html).toContain('Floor plan');
    // Floor plan img src embedded
    expect(html).toContain(FLOORPLAN_URL);
    // Photo grid also rendered
    expect(html).toContain(PHOTO_URL);
  });

  it('renders multiple floor plan images when present', () => {
    const html = renderReportHtml({
      ...data,
      photos: [],
      floorplans: [FLOORPLAN_URL, FLOORPLAN_URL_2],
      subjectVision: null,
    });
    expect(html).toContain(FLOORPLAN_URL);
    expect(html).toContain(FLOORPLAN_URL_2);
  });

  it('renders the section (with floor plan) even when photos is empty and vision is null', () => {
    const html = renderReportHtml({
      ...data,
      photos: [],
      floorplans: [FLOORPLAN_URL],
      subjectVision: null,
    });
    // Section is present
    expect(html).toContain('Property condition');
    expect(html).toContain('Floor plan');
    expect(html).toContain(FLOORPLAN_URL);
    // No photo grid element (photos is empty — the div with className="photo-grid" is not rendered)
    expect(html).not.toContain('class="photo-grid"');
  });

  it('floor plan block appears after the photo grid in the section', () => {
    const html = renderReportHtml({
      ...data,
      photos: [PHOTO_URL],
      floorplans: [FLOORPLAN_URL],
      subjectVision: null,
    });
    const photoGridIdx = html.indexOf(PHOTO_URL);
    const floorplanIdx = html.indexOf(FLOORPLAN_URL);
    expect(photoGridIdx).toBeLessThan(floorplanIdx);
  });

  it('does not render Floor plan label when floorplans is empty', () => {
    const html = renderReportHtml({
      ...data,
      photos: [PHOTO_URL],
      floorplans: [],
      subjectVision: null,
    });
    expect(html).not.toContain('Floor plan');
  });
});

describe('Comparable source link rendering', () => {
  const comp = (listingUrl: string | null): Comparable => ({
    id: '150833140',
    address: '12/22 Warringah Road, Mosman NSW 2088',
    salePrice: 1_030_000,
    contractDate: '2026-05-26',
    distanceM: 120,
    lat: -33.818,
    lng: 151.245,
    beds: 2,
    baths: 2,
    landArea: null,
    propertyType: 'ApartmentUnitFlat',
    photos: [],
    listingUrl,
    visionAnalysis: null,
    similarityScore: 88,
    selection: 'fair-value',
    adjustments: [],
    adjustedValue: 1_050_000,
    adjustmentNarrative: null,
    source: {
      provider: 'rea',
      endpoint: '/properties/search?channel=sold',
      fetchedAt: '2026-05-31T00:00:00.000Z',
      path: '/comparables/0/salePrice',
    },
  });

  it('renders the source as a deep-link to the listing page when listingUrl is set', () => {
    const href = 'https://www.realestate.com.au/property-apartment-nsw-mosman-150833140';
    const html = renderReportHtml({ ...data, comparables: [comp(href)] });
    expect(html).toContain(`href="${href}"`);
    expect(html).toContain('class="src-link"');
    expect(html).toContain('Source: ');
  });

  it('renders plain-text source (no link) when listingUrl is null', () => {
    const html = renderReportHtml({ ...data, comparables: [comp(null)] });
    expect(html).toContain('Source: realestate.com.au');
    expect(html).not.toContain('class="src-link"');
  });
});

describe('Map legend rendering', () => {
  const MAP =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const mapComp = (id: string, address: string, price: number): Comparable => ({
    id,
    address,
    salePrice: price,
    contractDate: '2026-04-01',
    distanceM: 250,
    lat: -33.83,
    lng: 151.24,
    beds: 2,
    baths: 2,
    landArea: null,
    propertyType: 'ApartmentUnitFlat',
    photos: [],
    listingUrl: null,
    visionAnalysis: null,
    similarityScore: 85,
    selection: 'fair-value',
    adjustments: [],
    adjustedValue: null,
    adjustmentNarrative: null,
    source: { provider: 'rea', endpoint: '/x', fetchedAt: '2026-04-01T00:00:00.000Z', path: '/comparables/0/salePrice' },
  });

  it('renders a numbered price legend keyed to the map pins', () => {
    const comps = [
      mapComp('a', '5/116 Belmont Road, Mosman NSW 2088', 1_805_000),
      mapComp('b', '6/16 Bardwell Road, Mosman NSW 2088', 1_325_000),
    ];
    const html = renderReportHtml({ ...data, staticMapDataUrl: MAP, comparables: comps });
    expect(html).toContain('class="map-legend"'); // rendered element, not the CSS rule
    // street address (comma-stripped) + sale price both surfaced (NBSP after $)
    expect(html).toContain('5/116 Belmont Road');
    expect(html).toContain('1,805,000');
    expect(html).toContain('1,325,000');
    expect(html).toContain('keyed below');
  });

  it('omits the legend when there are no selected comps', () => {
    const html = renderReportHtml({ ...data, staticMapDataUrl: MAP, comparables: [] });
    expect(html).not.toContain('class="map-legend"');
    expect(html).not.toContain('keyed below');
  });
});
