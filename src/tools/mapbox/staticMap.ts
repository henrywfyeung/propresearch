// src/tools/mapbox/staticMap.ts — Mapbox Static Images API helper (CLAUDE.md §0).
// Builds a server-side static map URL for the subject + selected comps, fetches
// the PNG, and returns it as a base64 data URL so the Mapbox token never appears
// in the rendered PDF. On any failure (no token, non-2xx, network error, no
// valid coords) → returns null; rendering degrades gracefully.

import { logger } from '@/lib/observability/logger';

/** Maximum number of comp markers added to keep the URL length sane. */
const MAX_COMP_MARKERS = 15;

export interface LatLng {
  lat: number;
  lng: number;
}

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
 * @param subject  Subject-property coordinates (navy pin).
 * @param comps    Selected comp coordinates (grey pins); capped at MAX_COMP_MARKERS.
 */
export async function staticMapDataUrl(subject: LatLng, comps: LatLng[]): Promise<string | null> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) {
    logger.warn('staticMapDataUrl: MAPBOX_TOKEN not set — skipping map');
    return null;
  }

  // Subject marker: large navy (#1F3864) pin with a "home" glyph → stands out.
  const subjectMarker = `pin-l-home+1f3864(${subject.lng},${subject.lat})`;

  // Comp markers: small grey #888888, capped to MAX_COMP_MARKERS
  const compMarkers = comps
    .slice(0, MAX_COMP_MARKERS)
    .map((c) => `pin-s+888888(${c.lng},${c.lat})`);

  const overlays = [subjectMarker, ...compMarkers].join(',');

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
