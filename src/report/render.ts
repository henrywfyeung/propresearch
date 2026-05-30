// src/report/render.ts — SSR the report template to a standalone, print-ready
// HTML document (CLAUDE.md §13). Puppeteer turns this HTML into the A4 PDF in a
// later sub-increment; the same HTML powers the browser preview.

import { type ReportData, ReportDocument, reportStyles } from '@/report/template/ReportDocument';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderReportHtml(data: ReportData): string {
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
