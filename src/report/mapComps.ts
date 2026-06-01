// src/report/mapComps.ts — the single source of truth for WHICH comps appear on
// the location map and in WHAT order. Both the static-map pin builder (Node 13)
// and the report's map legend (ReportDocument) consume this so the numbered pins
// and the numbered price legend stay in lock-step (pin "3" === legend row "3").

import type { Comparable } from '@/schemas/state';

/** Max markers on the map — mirrors staticMap's MAX_COMP_MARKERS / Mapbox 2-digit labels. */
export const MAX_MAP_COMPS = 15;

/**
 * Selected comps (fair-value or negotiation-anchor) that have coordinates,
 * capped at {@link MAX_MAP_COMPS}, in their existing array order. Numbering is
 * 1-based by position in this list.
 */
export function selectedMapComps(comparables: Comparable[]): Comparable[] {
  return comparables
    .filter(
      (c) =>
        (c.selection === 'fair-value' || c.selection === 'negotiation-anchor') &&
        c.lat != null &&
        c.lng != null,
    )
    .slice(0, MAX_MAP_COMPS);
}
