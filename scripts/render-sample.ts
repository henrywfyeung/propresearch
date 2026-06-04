// scripts/render-sample.ts — generate a sample report HTML + PDF + PNG from
// representative data, to preview the look. Uses local Chrome via puppeteer-core
// (the production path uses @sparticuz/chromium on Vercel).
//
// Usage: [CHROME_PATH=...] pnpm tsx scripts/render-sample.ts

import { writeFileSync } from 'node:fs';
import { renderReportHtml } from '@/report/render';
import type { ReportData } from '@/report/template/ReportDocument';
import type { Comparable, CompVerdict } from '@/schemas/state';
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function comp(
  id: string,
  address: string,
  salePrice: number,
  contractDate: string,
  distanceM: number,
  selection: Comparable['selection'],
  verdict: CompVerdict,
  comparison: NonNullable<Comparable['comparison']>,
  adjustedValue: number,
): Comparable {
  return {
    id,
    address,
    salePrice,
    contractDate,
    distanceM,
    lat: -33.83,
    lng: 151.24,
    beds: 4,
    baths: 2,
    landArea: 540,
    propertyType: 'House',
    photos: [],
    listingUrl: `https://www.realestate.com.au/property-house-nsw-mosman-${id}`,
    visionAnalysis: null,
    similarityScore: 82,
    selection,
    verdict,
    comparison,
    adjustments: [],
    adjustedValue,
    adjustmentNarrative: null,
    source: {
      provider: 'rea',
      endpoint: '/properties/search?channel=sold',
      fetchedAt: '2026-05-31T00:00:00.000Z',
      path: '/comparables/0/salePrice',
    },
  };
}

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
    // Banded bounds derived from the comps below: inferior sales top out at
    // $4.0m, like-for-like cluster $4.32m–$4.55m, superior sales start at $5.1m.
    bands: {
      inferiorCap: 4_000_000,
      comparableLow: 4_320_000,
      comparableHigh: 4_550_000,
      superiorFloor: 5_100_000,
    },
  },
  comparables: [
    comp(
      'a',
      '26 Vista Street, Mosman NSW 2088',
      4_320_000,
      '2026-04-12',
      540,
      'fair-value',
      'comparable',
      {
        size: 'Near-identical 545m² block',
        layout: 'Same 4/2 single-storey layout',
        condition: 'Comparable, both recently refreshed',
        location: 'Same quiet pocket, one street over',
      },
      4_450_000,
    ),
    comp(
      'b',
      '46 Spencer Road, Mosman NSW 2088',
      4_550_000,
      '2026-02-16',
      1104,
      'fair-value',
      'comparable',
      {
        size: 'Larger 600m² block',
        layout: 'Extra study; otherwise alike',
        condition: 'Similar presentation',
        location: 'Busier road, slightly inferior position',
      },
      4_500_000,
    ),
    comp(
      'd',
      '8 Bardwell Road, Mosman NSW 2088',
      4_000_000,
      '2026-03-02',
      820,
      'rejected',
      'inferior',
      {
        size: 'Smaller 470m² block',
        layout: 'One fewer bedroom',
        condition: 'Original, unrenovated kitchen and bath',
        location: 'Comparable street',
      },
      4_100_000,
    ),
    comp(
      'c',
      '14 Erith Street, Mosman NSW 2088',
      5_300_000,
      '2026-04-11',
      1325,
      'negotiation-anchor',
      'superior',
      {
        size: 'Much larger 740m² parcel',
        layout: 'Five bedrooms over two storeys',
        condition: 'Architect-renovated throughout',
        location: 'Premium harbour-side street',
      },
      4_900_000,
    ),
  ],
  risks: [],
  recentDAs: [],
  suburbStats: null,
  demographics: null,
  schools: [],
  hospitals: [],
  planningControls: null,
  proximityHazards: null,
  prose: {
    summary: [
      {
        type: 'text',
        text: '12 Awaba Street is a well-presented four-bedroom house on a 540 m² parcel in central Mosman. On the weight of recent comparable sales its value sits in the low-to-mid $4 million range, with strong supporting evidence and limited downside risk at that level.',
      },
    ],
    subject: [
      {
        type: 'text',
        text: 'The property offers four bedrooms, two bathrooms and off-street parking for two cars across a 210 m² floorplan on 540 m² of land — a typical family-house configuration for the suburb.',
      },
    ],
    valuation: [
      {
        type: 'range',
        text: 'Estimated value {{lo}}–{{hi}}',
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
      {
        type: 'text',
        text: 'Like-for-like sales cluster between $4.32m and $4.55m, with an inferior, unrenovated sale at $4.0m setting a floor and a superior, architect-renovated home at $5.3m marking the ceiling. The subject sits comfortably inside the comparable band.',
      },
    ],
    comparables: [
      {
        type: 'text',
        text: 'The selected sales are all four-bedroom houses sold within the last four months, within roughly a kilometre of the subject. Each is judged superior, comparable or inferior across size, layout, condition and location.',
      },
    ],
  },
  generatedAt: '2026-05-31T00:00:00.000Z',
  staticMapDataUrl: null,
  mapHref: null,
  photos: [],
  floorplans: [],
  subjectVision: {
    condition: 'good',
    staging: 'lived-in-tidy',
    presentationFactors: ['Updated kitchen', 'Polished floorboards'],
    redFlags: [],
    layout: {
      storeys: 'double',
      structure: 'free-standing',
      positionInComplex: 'not-applicable',
      singleLevelLiving: true,
      streetFrontage: 'own-frontage',
      era: 'late-20th-century',
      configNotes: ['1x downstairs bedroom + bathroom', 'No shared walls'],
    },
    comment:
      'Well-presented double-storey home with a downstairs bedroom and bathroom; tidy throughout with no obvious defects in the supplied imagery.',
  },
};

async function main() {
  const html = renderReportHtml(data);
  writeFileSync('/tmp/sample-report.html', html);
  console.log('HTML -> /tmp/sample-report.html');

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '15mm', bottom: '20mm', left: '15mm' },
    });
    writeFileSync('/tmp/sample-report.pdf', pdf);
    console.log('PDF  -> /tmp/sample-report.pdf');

    await page.setViewport({ width: 880, height: 1245, deviceScaleFactor: 2 });
    const png = await page.screenshot({ fullPage: true });
    writeFileSync('/tmp/sample-report.png', png);
    console.log('PNG  -> /tmp/sample-report.png');
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
