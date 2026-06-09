// src/report/render.ts — SSR the report template to a standalone, print-ready
// HTML document (CLAUDE.md §13). Puppeteer turns this HTML into the A4 PDF in a
// later sub-increment; the same HTML powers the browser preview.

import { createRequire } from 'node:module';
import { type ReportData, ReportDocument, reportStyles } from '@/report/template/ReportDocument';
import { type ReactElement, createElement } from 'react';

// react-dom/server is loaded via createRequire (a runtime CJS require, NOT a static
// ESM import) so Next's App-Router build doesn't reject it when this module is
// pulled into the /api/inngest route graph (the Inngest worker runs the full render
// pipeline). renderToStaticMarkup is legitimate server-only use here — it produces
// the HTML string Puppeteer turns into the PDF, not a Next page. Keeping the import
// runtime-only avoids the "importing a component that imports react-dom/server" error
// while leaving renderReportHtml synchronous (no caller/test ripple).
const requireCjs = createRequire(import.meta.url);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderReportHtml(data: ReportData): string {
  const { renderToStaticMarkup } = requireCjs('react-dom/server') as {
    renderToStaticMarkup: (element: ReactElement) => string;
  };
  const body = renderToStaticMarkup(createElement(ReportDocument, { data }));
  return [
    '<!DOCTYPE html>',
    '<html lang="en-AU"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(data.address)} — Property Research Dossier</title>`,
    `<style>${reportStyles}</style>`,
    '</head><body>',
    body,
    '</body></html>',
  ].join('');
}
