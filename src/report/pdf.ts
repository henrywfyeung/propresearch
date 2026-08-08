// src/report/pdf.ts — HTML -> A4 PDF via Puppeteer (CLAUDE.md §13.3).
//
// Chromium is installed in the container image and located by CHROME_PATH.
// Locally, point CHROME_PATH at any Chrome/Chromium binary.
//
// This used to be 86 lines of Lambda scar tissue: @sparticuz/chromium-min ships
// no binary, so it downloaded a ~50MB pack from GitHub releases to /tmp on every
// cold start, then needed LD_LIBRARY_PATH patched by hand or Chromium died with
// "libnss3.so: cannot open shared object file" — and only performed that setup
// at all when AWS_LAMBDA_JS_RUNTIME contained the substring "20.x". Four
// production firefights (4a70ba1, 24383b3, 80ec2a5, 2a5c267) lived in here.
// Running our own container image deletes the entire category of problem.

import puppeteer from 'puppeteer-core';

async function launchBrowser() {
  const executablePath = process.env.CHROME_PATH;
  if (!executablePath) {
    throw new Error(
      'CHROME_PATH is not set. The worker image installs Chromium at ' +
        '/usr/bin/chromium; locally, point CHROME_PATH at a Chrome binary.',
    );
  }

  return puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      // No user namespaces inside the container sandbox.
      '--no-sandbox',
      '--disable-setuid-sandbox',
      // Cloud Run gives a small /dev/shm; without this Chromium crashes part
      // way through rendering a long report.
      '--disable-dev-shm-usage',
    ],
  });
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
