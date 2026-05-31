// Report template — CLAUDE.md §13. A self-contained, print-oriented React
// document rendered to static HTML, then to PDF (Puppeteer) at §13.3. Linear-
// inspired: dense, restrained colour, single navy accent (#1F3864), tabular-nums
// for money. v0: the four core sections (summary / subject / valuation /
// comparables); charts + self-hosted fonts arrive in later sub-increments.
//
// Authored with createElement (no JSX) so it renders identically under tsx
// (dev sample script), Vitest, and the Next/Vercel build — the repo's
// tsconfig uses `jsx: preserve`, which tsx/esbuild won't transform.

import { priceChartSvg } from '@/report/charts/priceChart';
import { formatValue, renderClaim } from '@/report/renderClaim';
import type { ClaimBlock, ReportProse } from '@/schemas/claims';
import type { Comparable } from '@/schemas/state';
import { type ReactElement, createElement as h } from 'react';

export interface ReportData {
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  subject: {
    beds: number;
    baths: number;
    parking: number;
    landArea: number | null;
    buildingArea: number | null;
    propertyType: string;
  };
  triangulation: {
    low: number;
    high: number;
    reconciled: number;
    confidence: 'high' | 'medium' | 'low';
    uncertaintyNote: string | null;
  } | null;
  comparables: Comparable[];
  prose: ReportProse;
  generatedAt: string; // ISO
}

const ACCENT = '#1F3864';

export const reportStyles = `
  :root { --accent: ${ACCENT}; --ink: #0A0A0A; --muted: #555; --line: #E4E4E7; --bg: #FFFFFF; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
    font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 10pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .num { font-variant-numeric: tabular-nums; }
  @page { size: A4; margin: 15mm 15mm 20mm 15mm; }
  .doc { max-width: 180mm; margin: 0 auto; padding: 4mm; }
  .masthead { background: var(--accent); color: #fff; padding: 18px 22px; border-radius: 6px; margin-bottom: 22px; }
  .masthead .kicker { text-transform: uppercase; letter-spacing: .14em; font-size: 7.5pt; opacity: .8; margin: 0 0 6px; }
  .masthead h1 { font-size: 17pt; margin: 0 0 4px; font-weight: 600; letter-spacing: -.01em; }
  .masthead .sub { font-size: 9.5pt; opacity: .85; margin: 0; }
  section { margin: 0 0 20px; break-inside: avoid; }
  h2 { font-size: 8pt; text-transform: uppercase; letter-spacing: .12em; color: var(--accent);
    border-bottom: 1.5px solid var(--accent); padding-bottom: 4px; margin: 0 0 10px; }
  p { margin: 0 0 8px; }
  .value-callout { border: 1px solid var(--line); border-left: 3px solid var(--accent);
    border-radius: 4px; padding: 14px 16px; margin: 0 0 12px; display: flex; align-items: baseline; gap: 14px; }
  .value-callout .amount { font-size: 19pt; font-weight: 600; color: var(--accent); letter-spacing: -.01em; }
  .value-callout .conf { font-size: 8pt; text-transform: uppercase; letter-spacing: .1em; padding: 2px 8px;
    border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
  .value-callout .conf.high { color: #1B7F4B; border-color: #1B7F4B; }
  .value-callout .conf.low { color: #C9302C; border-color: #C9302C; }
  .uncertainty { font-size: 9pt; color: #8A5A00; background: #FFF7E6; border: 1px solid #FFE3A3;
    border-radius: 4px; padding: 8px 10px; margin: 0 0 10px; }
  .chart { margin: 6px 0 12px; }
  .attrs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 18px; margin: 4px 0 10px; }
  .attrs .k { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .attrs .v { font-size: 11pt; font-weight: 600; }
  .comp { border: 1px solid var(--line); border-radius: 4px; padding: 10px 12px; margin: 0 0 8px; break-inside: avoid; }
  .comp .row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .comp .addr { font-weight: 600; font-size: 9.5pt; }
  .comp .price { font-weight: 600; color: var(--accent); }
  .comp .meta { font-size: 8.5pt; color: var(--muted); margin-top: 3px; }
  .badge { font-size: 7pt; text-transform: uppercase; letter-spacing: .08em; padding: 1.5px 6px;
    border-radius: 999px; border: 1px solid var(--accent); color: var(--accent); white-space: nowrap; }
  .badge.anchor { color: #8A5A00; border-color: #C99A00; }
  .src { font-size: 7.5pt; color: var(--muted); margin-top: 4px; }
  footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid var(--line);
    font-size: 7.5pt; color: var(--muted); display: flex; justify-content: space-between; }
`;

function paragraphs(blocks: ClaimBlock[] | undefined): ReactElement[] {
  return (blocks ?? [])
    .filter((b) => b.type !== 'range') // range shown in the value callout
    .map((b, i) => h('p', { key: `b${i}` }, renderClaim(b)));
}

function attr(label: string, value: string): ReactElement {
  return h(
    'div',
    { key: label },
    h('div', { className: 'k' }, label),
    h('div', { className: 'v num' }, value),
  );
}

export function ReportDocument({ data }: { data: ReportData }): ReactElement {
  const { subject, triangulation, prose, comparables } = data;
  const selected = comparables.filter(
    (c) => c.selection === 'fair-value' || c.selection === 'negotiation-anchor',
  );

  const masthead = h(
    'div',
    { className: 'masthead' },
    h('p', { className: 'kicker' }, 'Property Research Dossier'),
    h('h1', null, data.address),
    h(
      'p',
      { className: 'sub num' },
      `${data.suburb} ${data.state} ${data.postcode} · Generated ${formatValue(data.generatedAt, 'date')}`,
    ),
  );

  const summary = h(
    'section',
    { key: 'summary' },
    h('h2', null, 'Summary'),
    ...paragraphs(prose.summary),
  );

  const subjectSection = h(
    'section',
    { key: 'subject' },
    h('h2', null, 'Subject property'),
    h(
      'div',
      { className: 'attrs' },
      attr('Type', subject.propertyType),
      attr('Bedrooms', String(subject.beds)),
      attr('Bathrooms', String(subject.baths)),
      attr('Parking', String(subject.parking)),
      attr('Land', subject.landArea != null ? `${subject.landArea} m²` : '—'),
      attr('Building', subject.buildingArea != null ? `${subject.buildingArea} m²` : '—'),
    ),
    ...paragraphs(prose.subject),
  );

  const valuationChildren: ReactElement[] = [h('h2', { key: 'h' }, 'Valuation')];
  if (triangulation) {
    valuationChildren.push(
      h(
        'div',
        { key: 'callout', className: 'value-callout' },
        h(
          'span',
          { className: 'amount num' },
          `${formatValue(triangulation.low, 'currency-aud')} – ${formatValue(triangulation.high, 'currency-aud')}`,
        ),
        h(
          'span',
          { className: `conf ${triangulation.confidence}` },
          `${triangulation.confidence} confidence`,
        ),
      ),
    );
    if (triangulation.uncertaintyNote) {
      valuationChildren.push(
        h('p', { key: 'unc', className: 'uncertainty' }, triangulation.uncertaintyNote),
      );
    }
    if (selected.length > 0) {
      valuationChildren.push(
        h('div', {
          key: 'chart',
          className: 'chart',
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted SSR'd SVG from priceChartSvg() — built only from numbers + hard-coded literals, no user HTML; React has no other way to inline raw SVG.
          dangerouslySetInnerHTML: {
            __html: priceChartSvg({
              low: triangulation.low,
              high: triangulation.high,
              reconciled: triangulation.reconciled,
              comps: selected.map((c) => ({
                label: c.address,
                price: c.salePrice,
                selection:
                  c.selection === 'negotiation-anchor' ? 'negotiation-anchor' : 'fair-value',
              })),
            }),
          },
        }),
      );
    }
  }
  valuationChildren.push(...paragraphs(prose.valuation));
  const valuation = h('section', { key: 'valuation' }, ...valuationChildren);

  const compCards = selected.map((c) =>
    h(
      'div',
      { key: c.id, className: 'comp' },
      h(
        'div',
        { className: 'row' },
        h('span', { className: 'addr' }, c.address),
        h('span', { className: 'price num' }, formatValue(c.salePrice, 'currency-aud')),
      ),
      h(
        'div',
        { className: 'row' },
        h(
          'span',
          { className: 'meta num' },
          `${formatValue(c.contractDate, 'date')} · ${c.beds} bd / ${c.baths} ba · ${c.propertyType} · ${formatValue(c.distanceM, 'distance-m')} away${c.adjustedValue != null ? ` · adjusted ${formatValue(c.adjustedValue, 'currency-aud')}` : ''}`,
        ),
        h(
          'span',
          { className: `badge ${c.selection === 'negotiation-anchor' ? 'anchor' : ''}` },
          c.selection === 'negotiation-anchor' ? 'anchor' : 'fair value',
        ),
      ),
      h('div', { className: 'src' }, 'Source: realestate.com.au'),
    ),
  );
  const comparablesSection = h(
    'section',
    { key: 'comparables' },
    h('h2', null, `Comparable sales (${selected.length})`),
    ...paragraphs(prose.comparables),
    ...compCards,
  );

  const footer = h(
    'footer',
    null,
    h('span', null, 'PropResearch · personal research dossier'),
    h('span', { className: 'num' }, formatValue(data.generatedAt, 'date')),
  );

  return h(
    'div',
    { className: 'doc' },
    masthead,
    summary,
    subjectSection,
    valuation,
    comparablesSection,
    footer,
  );
}
