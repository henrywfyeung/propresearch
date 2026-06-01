// src/tools/mapbox/staticMap.ts — Mapbox Static Images API helper (CLAUDE.md §0).
// Builds a server-side static map URL for the subject + selected comps, fetches
// the PNG, and returns it as a base64 data URL so the Mapbox token never appears
// in the rendered PDF. On any failure (no token, non-2xx, network error, no
// valid coords) → returns null; rendering degrades gracefully.

import { logger } from '@/lib/observability/logger';

/** Maximum number of comp markers added to keep the URL length sane. */
const MAX_COMP_MARKERS = 15;

/** Comp pin colour — dark slate for legible white numerals on the colour base. */
const COMP_PIN_COLOR = '5b6573';

/** Max school markers on the map; nearest-first, kept small so it stays readable. */
const MAX_SCHOOL_MARKERS = 6;
/** School pin colour — green, distinct from the navy subject + slate comps. */
const SCHOOL_PIN_COLOR = '2e8b57';

export interface LatLng {
  lat: number;
  lng: number;
}

/** A comp marker: coordinates plus an optional 1–2 char label (its legend number). */
export type MapComp = LatLng & { label?: string };

/**
 * Build an interactive Google Maps URL centred on the subject coordinates.
 * Used to make the otherwise-static PDF map image a clickable link (PDF viewers
 * can't run a live map, but they honour link annotations) — opening it gives the
 * reader satellite, Street View, zoom and directions at the exact property.
 */
export function interactiveMapHref(subject: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${subject.lat},${subject.lng}`;
}

/**
 * Fetch a Mapbox Static Images PNG auto-fit to the subject + comp markers and
 * return it as a `data:image/png;base64,…` string, or `null` on any error.
 *
 * @param subject  Subject-property coordinates (navy home pin).
 * @param comps    Selected comp coordinates; capped at MAX_COMP_MARKERS. When a
 *                 `label` is given the pin is numbered (medium) to key into the
 *                 report's price legend; otherwise it's a small unlabelled pin.
 * @param schools  Nearby school/early-ed coordinates (green school-glyph pins);
 *                 capped at MAX_SCHOOL_MARKERS to keep the map readable.
 */
export async function staticMapDataUrl(
  subject: LatLng,
  comps: MapComp[],
  schools: LatLng[] = [],
): Promise<string | null> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) {
    logger.warn('staticMapDataUrl: MAPBOX_TOKEN not set — skipping map');
    return null;
  }

  // Subject marker: large navy (#1F3864) pin with a "home" glyph → stands out.
  const subjectMarker = `pin-l-home+1f3864(${subject.lng},${subject.lat})`;

  // Comp markers: numbered medium pins (so each dot is annotated and keys into
  // the price legend); fall back to a small unlabelled pin when no label.
  const compMarkers = comps
    .slice(0, MAX_COMP_MARKERS)
    .map((c) =>
      c.label
        ? `pin-m-${encodeURIComponent(c.label)}+${COMP_PIN_COLOR}(${c.lng},${c.lat})`
        : `pin-s+${COMP_PIN_COLOR}(${c.lng},${c.lat})`,
    );

  // School markers: small green pins with a "school" glyph (distinct from
  // subject + comps); nearest few only, so they don't crowd the map.
  const schoolMarkers = schools
    .slice(0, MAX_SCHOOL_MARKERS)
    .map((s) => `pin-s-school+${SCHOOL_PIN_COLOR}(${s.lng},${s.lat})`);

  const overlays = [subjectMarker, ...compMarkers, ...schoolMarkers].join(',');

  // streets-v12 → full-colour base map (roads, parks, water, labels) rather than
  // the muted grey light-v11. auto → Mapbox auto-fits the viewport to all markers;
  // padding avoids edge clipping.
  const url = new URL(
    `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlays}/auto/640x360@2x`,
  );
  url.searchParams.set('access_token', token);
  url.searchParams.set('padding', '40');

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      logger.warn({ status: res.status }, 'staticMapDataUrl: Mapbox returned non-2xx');
      return null;
    }
    const buf = await res.arrayBuffer();
    const base64 = Buffer.from(buf).toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (err) {
    logger.warn({ err }, 'staticMapDataUrl: fetch error — skipping map');
    return null;
  }
}
