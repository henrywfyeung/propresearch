// src/report/charts/salesTrendChart.ts — dependency-light SVG "recent sales over
// time" scatter. Complements priceChart.ts (which shows the price DISTRIBUTION):
// this adds the TIME axis so the reader sees WHEN each comparable sold and at what
// price, coloured by the same quality verdict, with the subject's estimate drawn
// as a horizontal reference line.
//
// Derived purely from the comparable pool we already fetch — no new data source.
// Pure + deterministic given its input (identical in browser preview and PDF).
// Deliberately NO regression/trend line: the comps are quality-mixed (a superior
// comp is dearer by nature, not by date), so a line over raw price-vs-time would
// conflate quality with time and mislead.

import { format } from 'date-fns';

export interface SalesTrendComp {
  price: number;
  /** ISO contract/sale date. */
  date: string;
  verdict?: 'superior' | 'comparable' | 'inferior' | null;
  selection?: 'fair-value' | 'negotiation-anchor';
}

export interface SalesTrendInput {
  comps: SalesTrendComp[];
  /** Subject estimate → horizontal reference line. */
  reconciled?: number | null;
}

const ACCENT = '#1F3864';
const ANCHOR = '#C99A00';
const SUPERIOR = '#2E8B57';
const INFERIOR = '#9AA3AD';

function aud(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}m`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function dotColor(c: SalesTrendComp): string {
  if (c.verdict === 'superior') return SUPERIOR;
  if (c.verdict === 'inferior') return INFERIOR;
  if (c.verdict === 'comparable') return ACCENT;
  return c.selection === 'negotiation-anchor' ? ANCHOR : ACCENT;
}

interface Pt {
  t: number;
  price: number;
  c: SalesTrendComp;
}

/** Returns '' (caller omits the chart) when fewer than two dated sales exist. */
export function salesTrendChartSvg(input: SalesTrendInput): string {
  const pts: Pt[] = input.comps
    .map((c) => ({ t: new Date(c.date).getTime(), price: c.price, c }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.price))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return '';

  const W = 520;
  const H = 188;
  const mL = 48;
  const mR = 12;
  const mT = 14;
  const mB = 26;
  const plotW = W - mL - mR;
  const plotH = H - mT - mB;

  const tMin = pts[0]!.t;
  const tMax = pts[pts.length - 1]!.t;
  const tSpan = tMax - tMin || 1;
  const recon = typeof input.reconciled === 'number' ? input.reconciled : null;
  const prices = [...pts.map((p) => p.price), ...(recon != null ? [recon] : [])];
  const pMin = Math.min(...prices);
  const pMax = Math.max(...prices);
  const pSpan = pMax - pMin || pMax || 1;
  const yLo = pMin - pSpan * 0.08;
  const yHi = pMax + pSpan * 0.08;

  const x = (t: number) => mL + ((t - tMin) / tSpan) * plotW;
  const y = (p: number) => mT + (1 - (p - yLo) / (yHi - yLo)) * plotH;

  const parts: string[] = [
    `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Recent comparable sale prices over time, coloured by quality verdict" xmlns="http://www.w3.org/2000/svg">`,
  ];

  // --- y gridlines + price labels (4 ticks) ---
  for (let i = 0; i <= 3; i++) {
    const p = yLo + ((yHi - yLo) * i) / 3;
    const yy = y(p);
    parts.push(
      `<line x1="${mL}" y1="${yy.toFixed(1)}" x2="${W - mR}" y2="${yy.toFixed(1)}" stroke="#EEE" stroke-width="1"/>`,
      `<text x="${mL - 5}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-size="7.5" fill="#777">${aud(p)}</text>`,
    );
  }

  // --- subject estimate reference line ---
  if (recon != null) {
    const ry = y(recon);
    parts.push(
      `<line x1="${mL}" y1="${ry.toFixed(1)}" x2="${W - mR}" y2="${ry.toFixed(1)}" stroke="${ACCENT}" stroke-width="1.1" stroke-dasharray="3 2"/>`,
      `<text x="${W - mR}" y="${(ry - 3).toFixed(1)}" text-anchor="end" font-size="7.5" font-weight="600" fill="${ACCENT}">${aud(recon)} estimate</text>`,
    );
  }

  // --- x axis + end-date labels ---
  parts.push(
    `<line x1="${mL}" y1="${H - mB}" x2="${W - mR}" y2="${H - mB}" stroke="#E4E4E7" stroke-width="1"/>`,
    `<text x="${mL}" y="${H - mB + 12}" font-size="7.5" fill="#777">${format(new Date(tMin), 'MMM yyyy')}</text>`,
    `<text x="${W - mR}" y="${H - mB + 12}" text-anchor="end" font-size="7.5" fill="#777">${format(new Date(tMax), 'MMM yyyy')}</text>`,
  );

  // --- dots ---
  for (const p of pts) {
    parts.push(
      `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.price).toFixed(1)}" r="3.6" fill="${dotColor(p.c)}" fill-opacity="0.85"/>`,
    );
  }

  // --- legend (centred) ---
  const hasVerdict = pts.some((p) => p.c.verdict != null);
  const legend: Array<[string, string]> = hasVerdict
    ? [
        [SUPERIOR, 'superior'],
        [ACCENT, 'comparable'],
        [INFERIOR, 'inferior'],
      ]
    : [
        [ACCENT, 'fair value'],
        [ANCHOR, 'anchor'],
      ];
  const itemW = 78;
  let lx = W / 2 - (legend.length * itemW) / 2;
  for (const [color, label] of legend) {
    parts.push(
      `<circle cx="${(lx + 5).toFixed(1)}" cy="${(H - 5).toFixed(1)}" r="3.6" fill="${color}"/>`,
      `<text x="${(lx + 13).toFixed(1)}" y="${(H - 2).toFixed(1)}" font-size="7.5" fill="#555">${label}</text>`,
    );
    lx += itemW;
  }

  parts.push('</svg>');
  return parts.join('');
}
