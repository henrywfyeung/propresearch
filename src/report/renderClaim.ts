// Claim rendering — CLAUDE.md §7.12. At PDF time, substitute {{v}} / {{lo}} /
// {{hi}} in a ClaimBlock's text with the typed value(s), formatted per the
// `format` hint. AUD currency uses a non-breaking space between symbol and
// amount; percent rounds to 1 d.p.; etc.
//
// Pure + deterministic so it's unit-testable and identical in the browser
// preview and the Puppeteer PDF render.

import type { ClaimBlock, ClaimFormat } from '@/schemas/claims';

const NBSP = ' ';

const audFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

export function formatValue(value: number | string, format: ClaimFormat): string {
  switch (format) {
    case 'currency-aud': {
      const n = typeof value === 'number' ? value : Number(value);
      // Intl renders "$1,200,000"; insert NBSP after the symbol for clean
      // typographic spacing + tabular-nums alignment in the PDF.
      return audFormatter
        .format(n)
        .replace(/^(\D+)/, `$1${NBSP}`)
        .replace(NBSP + NBSP, NBSP);
    }
    case 'percent': {
      const n = typeof value === 'number' ? value : Number(value);
      return `${n.toFixed(1)}%`;
    }
    case 'count': {
      const n = typeof value === 'number' ? value : Number(value);
      return new Intl.NumberFormat('en-AU').format(n);
    }
    case 'distance-m': {
      const n = typeof value === 'number' ? value : Number(value);
      return n >= 1000 ? `${(n / 1000).toFixed(1)}${NBSP}km` : `${Math.round(n)}${NBSP}m`;
    }
    case 'duration-days': {
      const n = typeof value === 'number' ? value : Number(value);
      return `${Math.round(n)}${NBSP}${Math.round(n) === 1 ? 'day' : 'days'}`;
    }
    case 'date': {
      const d = typeof value === 'string' ? new Date(value) : new Date(value);
      return new Intl.DateTimeFormat('en-AU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(d);
    }
    default:
      return String(value);
  }
}

/**
 * Render a ClaimBlock to a final string. `text`/`comp-ref` blocks pass
 * through; `claim` substitutes {{v}}; `range` substitutes {{lo}}/{{hi}}.
 */
export function renderClaim(block: ClaimBlock): string {
  switch (block.type) {
    case 'text':
    case 'comp-ref':
      return block.text;
    case 'claim':
      return block.text.replace(/\{\{v\}\}/g, formatValue(block.value, block.format));
    case 'range':
      return block.text
        .replace(/\{\{lo\}\}/g, formatValue(block.low, block.format))
        .replace(/\{\{hi\}\}/g, formatValue(block.high, block.format));
    default: {
      // exhaustiveness guard
      const _never: never = block;
      return String(_never);
    }
  }
}
