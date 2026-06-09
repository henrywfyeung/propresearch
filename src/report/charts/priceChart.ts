// src/report/charts/priceChart.ts — dependency-free SVG price-position chart.
//
// Two layers, adopted from a professional CMA's banded scatter:
//   1. the subject's similarity-weighted estimate range (band + reconciled tick);
//   2. the comparable sales as dots, coloured by quality VERDICT vs the subject
//      (green = superior, navy = comparable, grey = inferior), with the
//      like-for-like band shaded and the inferior-cap / superior-floor bounds
//      drawn as the bracket the estimate should sit within.
// Falls back to selection-coloured dots (navy / amber) when no verdict is
// present. Pure + deterministic: identical in the browser preview and the PDF.

export interface PriceChartComp {
  label: string;
  price: number;
  selection: 'fair-value' | 'negotiation-anchor';
  verdict?: 'superior' | 'comparable' | 'inferior' | null;
}

export interface PriceChartBands {
  inferiorCap: number | null;
  comparableLow: number | null;
  comparableHigh: number | null;
  superiorFloor: number | null;
}

export interface PriceChartInput {
  low: number;
  high: number;
  reconciled: number;
  comps: PriceChartComp[];
  bands?: PriceChartBands | null;
}

const ACCENT = '#1F3864'; // comparable / estimate (brand navy)
const ANCHOR = '#C99A00'; // negotiation anchor (fallback colouring)
const SUPERIOR = '#2E8B57'; // green
const INFERIOR = '#9AA3AD'; // grey

function aud(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}m`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function dotColor(c: PriceChartComp): string {
  if (c.verdict === 'superior') return SUPERIOR;
  if (c.verdict === 'inferior') return INFERIOR;
  if (c.verdict === 'comparable') return ACCENT;
  return c.selection === 'negotiation-anchor' ? ANCHOR : ACCENT;
}

export function priceChartSvg(input: PriceChartInput): string {
  const W = 520;
  const H = 132;
  const padX = 16;
  const yReconLabel = 12;
  const yBracket = 24;
  const yBandTop = 52;
  const yBandBot = 94;
  const yAxis = 73;
  const yBoundLabel = 48;
  const yScale = H - 6;

  const bands = input.bands ?? null;
  const hasVerdict = input.comps.some((c) => c.verdict != null);

  // Scale across everything we draw so nothing clips.
  const pts = [
    ...input.comps.map((c) => c.price),
    input.low,
    input.high,
    input.reconciled,
    bands?.inferiorCap,
    bands?.comparableLow,
    bands?.comparableHigh,
    bands?.superiorFloor,
  ].filter((n): n is number => typeof n === 'number');
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || max || 1;
  const lo = min - span * 0.06;
  const hi = max + span * 0.06;
  const x = (p: number) => padX + ((p - lo) / (hi - lo)) * (W - 2 * padX);

  const parts: string[] = [
    `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Comparable sale prices by quality verdict versus the estimated value range" xmlns="http://www.w3.org/2000/svg">`,
  ];

  // --- comparable band shading (behind everything) ---
  if (bands?.comparableLow != null && bands.comparableHigh != null) {
    const bx = x(bands.comparableLow);
    const bw = Math.max(2, x(bands.comparableHigh) - bx);
    parts.push(
      `<rect x="${bx.toFixed(1)}" y="${yBandTop}" width="${bw.toFixed(1)}" height="${yBandBot - yBandTop}" fill="${ACCENT}" fill-opacity="0.07" stroke="${ACCENT}" stroke-opacity="0.18" rx="3"/>`,
    );
  }

  // --- inferior cap / superior floor bound lines ---
  if (bands?.inferiorCap != null) {
    const ix = x(bands.inferiorCap);
    parts.push(
      `<line x1="${ix.toFixed(1)}" y1="${yBandTop}" x2="${ix.toFixed(1)}" y2="${yBandBot}" stroke="${INFERIOR}" stroke-width="1" stroke-dasharray="2 2"/>`,
      `<text x="${ix.toFixed(1)}" y="${yBoundLabel}" text-anchor="middle" font-size="7.5" fill="${INFERIOR}">inferior ≤ ${aud(bands.inferiorCap)}</text>`,
    );
  }
  if (bands?.superiorFloor != null) {
    const sx = x(bands.superiorFloor);
    parts.push(
      `<line x1="${sx.toFixed(1)}" y1="${yBandTop}" x2="${sx.toFixed(1)}" y2="${yBandBot}" stroke="${SUPERIOR}" stroke-width="1" stroke-dasharray="2 2"/>`,
      `<text x="${sx.toFixed(1)}" y="${yBoundLabel}" text-anchor="middle" font-size="7.5" fill="${SUPERIOR}">superior ≥ ${aud(bands.superiorFloor)}</text>`,
    );
  }

  // --- estimate range bracket + reconciled tick (top) ---
  const exLow = x(input.low);
  const exHigh = x(input.high);
  const recX = x(input.reconciled);
  parts.push(
    `<line x1="${exLow.toFixed(1)}" y1="${yBracket}" x2="${exHigh.toFixed(1)}" y2="${yBracket}" stroke="${ACCENT}" stroke-width="1.5"/>`,
    `<line x1="${exLow.toFixed(1)}" y1="${yBracket - 4}" x2="${exLow.toFixed(1)}" y2="${yBracket + 4}" stroke="${ACCENT}" stroke-width="1.5"/>`,
    `<line x1="${exHigh.toFixed(1)}" y1="${yBracket - 4}" x2="${exHigh.toFixed(1)}" y2="${yBracket + 4}" stroke="${ACCENT}" stroke-width="1.5"/>`,
    `<line x1="${recX.toFixed(1)}" y1="${yBracket - 6}" x2="${recX.toFixed(1)}" y2="${yAxis + 6}" stroke="${ACCENT}" stroke-width="1.2" stroke-dasharray="3 2"/>`,
    `<text x="${recX.toFixed(1)}" y="${yReconLabel}" text-anchor="middle" font-size="8.5" font-weight="600" fill="${ACCENT}">${aud(input.reconciled)} estimate</text>`,
  );

  // --- axis + comp dots ---
  parts.push(
    `<line x1="${padX}" y1="${yAxis}" x2="${W - padX}" y2="${yAxis}" stroke="#E4E4E7" stroke-width="1"/>`,
  );
  for (const c of input.comps) {
    parts.push(
      `<circle cx="${x(c.price).toFixed(1)}" cy="${yAxis}" r="4" fill="${dotColor(c)}" fill-opacity="0.88"/>`,
    );
  }

  // --- scale endpoints + legend ---
  parts.push(
    `<text x="${padX}" y="${yScale}" font-size="8" fill="#555">${aud(lo)}</text>`,
    `<text x="${W - padX}" y="${yScale}" text-anchor="end" font-size="8" fill="#555">${aud(hi)}</text>`,
  );

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
  // Centre the legend row.
  const itemW = 78;
  const totalW = legend.length * itemW;
  let lx = W / 2 - totalW / 2;
  for (const [color, label] of legend) {
    parts.push(
      `<circle cx="${(lx + 5).toFixed(1)}" cy="${yScale - 3}" r="4" fill="${color}"/>`,
      `<text x="${(lx + 14).toFixed(1)}" y="${yScale}" font-size="8" fill="#555">${label}</text>`,
    );
    lx += itemW;
  }

  parts.push('</svg>');
  return parts.join('');
}
