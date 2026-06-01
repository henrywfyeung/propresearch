// src/tools/market/suburbStats.ts — pure, deterministic suburb market summary
// derived from the comp pool already in graph state. No external data fetch.
// CLAUDE.md §0: "Suburb market context" section.

import type { Comparable } from '@/schemas/state';

export interface SuburbStats {
  sampleSize: number;
  medianSalePrice: number;
  minSalePrice: number;
  maxSalePrice: number;
  /** null when no beds data (all zero is still 0, not null) */
  medianBeds: number | null;
  /** null when no baths data */
  medianBaths: number | null;
  /** ISO date string of the most recent contractDate, or null when none */
  mostRecentSaleDate: string | null;
}

/**
 * Compute a simple suburb market summary from the candidate comp pool.
 * Returns null if fewer than 3 comps have a finite positive salePrice —
 * not enough data to be meaningful.
 */
export function computeSuburbStats(comps: Comparable[]): SuburbStats | null {
  const priced = comps.filter((c) => Number.isFinite(c.salePrice) && c.salePrice > 0);
  if (priced.length < 3) return null;

  const prices = priced.map((c) => c.salePrice).sort((a, b) => a - b);
  const beds = priced.map((c) => c.beds).sort((a, b) => a - b);
  const baths = priced.map((c) => c.baths).sort((a, b) => a - b);

  const dates = priced
    .map((c) => c.contractDate)
    .filter((d): d is string => typeof d === 'string' && d.length > 0)
    .sort();

  return {
    sampleSize: priced.length,
    medianSalePrice: median(prices),
    minSalePrice: prices[0] ?? 0,
    maxSalePrice: prices[prices.length - 1] ?? 0,
    medianBeds: beds.length > 0 ? median(beds) : null,
    medianBaths: baths.length > 0 ? median(baths) : null,
    mostRecentSaleDate: dates.length > 0 ? (dates[dates.length - 1] ?? null) : null,
  };
}

/** Proper median: sort + middle for odd, mean of two middles for even. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  // even: mean of the two middle elements
  const lo = sorted[mid - 1] ?? 0;
  const hi = sorted[mid] ?? 0;
  return (lo + hi) / 2;
}
