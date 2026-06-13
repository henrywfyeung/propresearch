// src/report/pdf.ts — HTML -> A4 PDF via Puppeteer (CLAUDE.md §13.3).
// Dev: set CHROME_PATH to a local Chrome/Chromium.
// Serverless (Vercel): @sparticuz/chromium-min ships NO binary — it downloads +
// extracts a Chromium "pack" to /tmp at runtime, which sidesteps the bundling /
// file-tracing / pnpm-symlink problems of the full package on Vercel.

import path from 'node:path';
import { logger } from '@/lib/observability/logger';
import puppeteer from 'puppeteer-core';

// Default to the official v131 release pack (matches puppeteer-core 23.8.0).
// Override with CHROMIUM_PACK_URL to mirror it (e.g. on our own S3) if the
// GitHub release ever rate-limits or is slow.
const PACK_URL =
  process.env.CHROMIUM_PACK_URL ??
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar';

// Cache the extracted binary path across warm invocations (the pack download +
// extraction only needs to happen on a cold start).
let cachedExecPath: string | undefined;

async function launchBrowser() {
  const chromePath = process.env.CHROME_PATH;
  if (chromePath) {
    return puppeteer.launch({
      executablePath: chromePath,
      args: ['--no-sandbox'],
      headless: true,
    });
  }

  const chromium = (await import('@sparticuz/chromium-min')).default;
  if (!cachedExecPath) {
    cachedExecPath = await chromium.executablePath(PACK_URL);
  }
  const executablePath = cachedExecPath;

  // The dynamic loader doesn't search the extraction dir by default, so Chromium
  // dies with "libnss3.so / libnspr4.so: cannot open shared object file". Point
  // LD_LIBRARY_PATH at the binary's dir (where the .so libs are extracted).
  const libDir = path.dirname(executablePath);
  process.env.LD_LIBRARY_PATH = [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');

  try {
    return await puppeteer.launch({ executablePath, args: chromium.args, headless: true });
  } catch (err) {
    // On failure, dump the actual lib dir so a "cannot open shared object"
    // recurrence is fully diagnosable from logs (which lib is missing vs present).
    try {
      const fs = await import('node:fs');
      logger.error(
        {
          err: String(err),
          libDir,
          files: fs.existsSync(libDir) ? fs.readdirSync(libDir) : 'MISSING',
        },
        'chromium launch failed: lib dir contents',
      );
    } catch {
      /* diagnostic only */
    }
    throw err;
  }
}

const FOOTER_TEMPLATE =
  '<div style="width:100%;font-size:7pt;color:#999;padding:0 15mm;text-align:right;">' +
  'Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>';

export async function renderReportPdf(html: string): Promise<Uint8Array> {
  const browser = await launchBrowser();
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
