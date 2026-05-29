// Mapbox forward geocoding — Node 01 fallback when the Domain Address
// Suggestions confidence is too low (CLAUDE.md §7.1). Uses the documented
// Mapbox Geocoding v6 response shape; validated with Zod so a Mapbox API
// change surfaces as SchemaDriftError rather than silent bad coordinates.

import { SchemaDriftError } from '@/lib/errors';
import pRetry from 'p-retry';
import { z } from 'zod';

const MAPBOX_FEATURE = z.object({
  properties: z.object({
    full_address: z.string().optional(),
    name: z.string().optional(),
    coordinates: z.object({ longitude: z.number(), latitude: z.number() }).optional(),
  }),
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number(), z.number()]), // [lng, lat]
  }),
});

const MAPBOX_RESPONSE = z.object({
  features: z.array(MAPBOX_FEATURE),
});

export interface GeocodeResult {
  lat: number;
  lng: number;
  /** Mapbox doesn't return a 0-1 confidence on v6; we proxy it as 1/rank. */
  confidence: number;
  matchedAddress: string | null;
}

export async function forwardGeocode(address: string): Promise<GeocodeResult | null> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) throw new Error('MAPBOX_TOKEN is not set');

  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('q', address);
  url.searchParams.set('country', 'AU');
  url.searchParams.set('limit', '1');
  url.searchParams.set('access_token', token);

  const raw = await pRetry(
    async () => {
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Mapbox ${res.status}`);
      return (await res.json()) as unknown;
    },
    { retries: 3, minTimeout: 500, factor: 2 },
  );

  const parsed = MAPBOX_RESPONSE.safeParse(raw);
  if (!parsed.success) {
    throw new SchemaDriftError('Mapbox geocode response failed validation', {
      issues: parsed.error.issues,
    });
  }

  const feature = parsed.data.features[0];
  if (!feature) return null;

  const [lng, lat] = feature.geometry.coordinates;
  return {
    lat,
    lng,
    confidence: 1, // single best match; refine if we request more candidates
    matchedAddress: feature.properties.full_address ?? feature.properties.name ?? null,
  };
}
