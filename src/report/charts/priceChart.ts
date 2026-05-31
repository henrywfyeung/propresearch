// src/report/charts/priceChart.ts — dependency-free SVG price-position chart:
// the subject's estimated value range as a band + a reconciled marker, with each
// comparable's sale price as a dot (navy = fair-value, amber = negotiation
// anchor). Pure + deterministic, so it renders identically in the browser
// preview and the Puppeteer PDF. Richer Observable Plot charts can come later.

export interface PriceChartComp {
  label: string;
  price: number;
  selection: 'fair-value' | 'negotiation-anchor';
}

export interface PriceChartInput {
  low: number;
  high: number;
  reconciled: number;
  comps: PriceChartComp[];
}

const ACCENT = '#1F3864';
const ANCHOR = '#C99A00';

function aud(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}m`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

export function priceChartSvg(input: PriceChartInput): string {
  const W = 520;
  const H = 88;
  const padX = 14;
  const padTop = 16;
  const axisY = 54;

  const prices = [...input.comps.map((c) => c.price), input.low, input.high, input.reconciled];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || max || 1;
  const lo = min - span * 0.05;
  const hi = max + span * 0.05;
  const x = (p: number) => padX + ((p - lo) / (hi - lo)) * (W - 2 * padX);

  const bandX = x(input.low);
  const bandW = Math.max(2, x(input.high) - x(input.low));
  const recX = x(input.reconciled);

  const dots = input.comps
    .map((c) => {
      const fill = c.selection === 'negotiation-anchor' ? ANCHOR : ACCENT;
      return `<circle cx="${x(c.price).toFixed(1)}" cy="${axisY}" r="4.5" fill="${fill}" fill-opacity="0.85"/>`;
    })
    .join('');

  return [
    `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Comparable sale prices versus the estimated value range" xmlns="http://www.w3.org/2000/svg">`,
    `<rect x="${bandX.toFixed(1)}" y="${padTop}" width="${bandW.toFixed(1)}" height="${axisY - padTop + 8}" fill="${ACCENT}" fill-opacity="0.08" stroke="${ACCENT}" stroke-opacity="0.25" rx="3"/>`,
    `<line x1="${recX.toFixed(1)}" y1="${padTop - 3}" x2="${recX.toFixed(1)}" y2="${axisY + 8}" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="3 2"/>`,
    `<text x="${recX.toFixed(1)}" y="${padTop - 5}" text-anchor="middle" font-size="8" fill="${ACCENT}">${aud(input.reconciled)}</text>`,
    `<line x1="${padX}" y1="${axisY}" x2="${W - padX}" y2="${axisY}" stroke="#E4E4E7" stroke-width="1"/>`,
    dots,
    `<text x="${padX}" y="${H - 8}" font-size="8" fill="#555">${aud(lo)}</text>`,
    `<text x="${W - padX}" y="${H - 8}" text-anchor="end" font-size="8" fill="#555">${aud(hi)}</text>`,
    `<text x="${(bandX + bandW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="8" fill="${ACCENT}">${aud(input.low)}–${aud(input.high)} range</text>`,
    '</svg>',
  ].join('');
}
