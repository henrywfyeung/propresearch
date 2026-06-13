// src/report/pdf.ts — HTML -> A4 PDF via Puppeteer (CLAUDE.md §13.3).
// Dev: set CHROME_PATH to a local Chrome/Chromium. Vercel/serverless: falls back
// to the bundled @sparticuz/chromium (Linux). Returns the PDF bytes; the caller
// streams them or uploads to storage.

import path from 'node:path';
import { logger } from '@/lib/observability/logger';
import puppeteer from 'puppeteer-core';

async function launchOptions() {
  const chromePath = process.env.CHROME_PATH;
  if (chromePath) {
    return { executablePath: chromePath, args: ['--no-sandbox'], headless: true as const };
  }
  const chromium = (await import('@sparticuz/chromium')).default;
  const executablePath = await chromium.executablePath();

  // CRITICAL on Vercel: @sparticuz/chromium extracts Chromium and its shared
  // libraries (libnss3.so, libnspr4.so, …) next to the binary in /tmp, but the
  // dynamic loader doesn't search that directory by default — so the launch dies
  // with "libnss3.so: cannot open shared object file". Point LD_LIBRARY_PATH at
  // the binary's directory before launching. (The libs themselves are shipped in
  // @sparticuz/chromium/bin and force-included into this function via
  // next.config.ts outputFileTracingIncludes.)
  const libDir = path.dirname(executablePath);
  process.env.LD_LIBRARY_PATH = [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');

  // One-time diagnostic so a recurrence is fully explainable from logs (is the
  // lib present? where?). Cheap; only runs on the serverless launch path.
  try {
    const fs = await import('node:fs');
    logger.info(
      {
        executablePath,
        libDir,
        libnss3Present: fs.existsSync(path.join(libDir, 'libnss3.so')),
        libDirSample: fs.existsSync(libDir) ? fs.readdirSync(libDir).slice(0, 40) : null,
      },
      'chromium launch: lib resolution',
    );
  } catch {
    /* diagnostic only */
  }

  return { executablePath, args: chromium.args, headless: true as const };
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
