// src/report/pdf.ts — HTML -> A4 PDF via Puppeteer (CLAUDE.md §13.3).
// Dev: set CHROME_PATH to a local Chrome/Chromium. Vercel/serverless: falls back
// to the bundled @sparticuz/chromium (Linux). Returns the PDF bytes; the caller
// streams them or uploads to storage.

import puppeteer from 'puppeteer-core';

async function launchOptions() {
  const chromePath = process.env.CHROME_PATH;
  if (chromePath) {
    return { executablePath: chromePath, args: ['--no-sandbox'], headless: true as const };
  }
  const chromium = (await import('@sparticuz/chromium')).default;
  return {
    executablePath: await chromium.executablePath(),
    args: chromium.args,
    headless: true as const,
  };
}

const FOOTER_TEMPLATE =
  '<div style="width:100%;font-size:7pt;color:#999;padding:0 15mm;text-align:right;">' +
  'Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>';

export async function renderReportPdf(html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch(await launchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60_000 });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '15mm', bottom: '20mm', left: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: FOOTER_TEMPLATE,
    });
  } finally {
    await browser.close();
  }
}
