// scripts/render-sample.ts — generate a sample report HTML + PDF + PNG from
// representative data, to preview the look. Uses local Chrome via puppeteer-core
// (the production path uses @sparticuz/chromium on Vercel).
//
// Usage: [CHROME_PATH=...] pnpm tsx scripts/render-sample.ts

import { writeFileSync } from 'node:fs';
import { renderReportHtml } from '@/report/render';
import type { ReportData } from '@/report/template/ReportDocument';
import type { Comparable } from '@/schemas/state';
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function comp(
  id: string,
  address: string,
  salePrice: number,
  contractDate: string,
  baths: number,
  distanceM: number,
  selection: Comparable['selection'],
  adjustedValue: number,
): Comparable {
  return {
    id,
    address,
    salePrice,
    contractDate,
    distanceM,
    beds: 4,
    baths,
    landArea: 540,
    propertyType: 'House',
    photos: [],
    visionAnalysis: null,
    similarityScore: 82,
    selection,
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
  },
  comparables: [
    comp(
      'a',
      '26 Vista Street, Mosman NSW 2088',
      4_320_000,
      '2026-04-12',
      2,
      540,
      'fair-value',
      4_450_000,
    ),
    comp(
      'b',
      '46 Spencer Road, Mosman NSW 2088',
      3_990_000,
      '2026-02-16',
      2,
      1104,
      'fair-value',
      4_300_000,
    ),
    comp(
      'c',
      '14 Erith Street, Mosman NSW 2088',
      5_300_000,
      '2026-04-11',
      3,
      1325,
      'negotiation-anchor',
      4_900_000,
    ),
  ],
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
        text: 'Three fair-value comparables on similar land sizes cluster tightly between $4.0m and $4.3m once adjusted toward the subject, supporting a confident estimate. The $5.3m anchor sale on a larger parcel marks the upper bound a vendor may reach for.',
      },
    ],
    comparables: [
      {
        type: 'text',
        text: 'The selected sales are all four-bedroom houses sold within the last four months, within roughly a kilometre of the subject.',
      },
    ],
  },
  generatedAt: '2026-05-31T00:00:00.000Z',
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
