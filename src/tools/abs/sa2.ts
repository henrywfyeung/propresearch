// src/tools/abs/sa2.ts
// Resolves a WGS-84 point to its ASGS 2021 SA2 (Statistical Area Level 2).
//
// Endpoint: ABS ArcGIS / ASGS2021 / SA2 MapServer layer 0
// IMPORTANT: geometry param is lng,lat (X,Y) — standard Esri order,
//            NOT the lat,lng convention used by the VIC WFS. See spec §1.
//
// Mirrors src/tools/nsw-risk/arcgis.ts: pRetry on 429/5xx, AbortError on
// non-retryable, Zod at the boundary, null-on-error (enrichment, never fatal).

import { logger } from '@/lib/observability/logger';
import pRetry, { AbortError } from 'p-retry';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

function asgsBase(): string {
  return (
    process.env.ABS_ASGS_BASE ??
    'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/SA2/MapServer/0'
  );
}

// ---------------------------------------------------------------------------
// Retryable statuses
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// ---------------------------------------------------------------------------
// Response schema
// Attributes come back LOWERCASE from this ArcGIS service (confirmed live).
// ---------------------------------------------------------------------------

const Sa2AttributesSchema = z.object({
  sa2_code_2021: z.string(),
  sa2_name_2021: z.string(),
});

const Sa2QueryResponseSchema = z.object({
  features: z.array(
    z.object({
      attributes: Sa2AttributesSchema,
    }),
  ),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a WGS-84 point to its SA2 code and name.
 *
 * Returns null when the point falls outside any SA2 (ocean, overseas) or on
 * any network / parse error — this is enrichment data, never fatal.
 *
 * @param lat  WGS-84 latitude  (e.g. -33.8329)
 * @param lng  WGS-84 longitude (e.g. 151.2432)
 */
export async function resolveSa2(
  lat: number,
  lng: number,
): Promise<{ sa2Code: string; sa2Name: string } | null> {
  const base = asgsBase();

  // Esri geometry param is X,Y = lng,lat — NOT lat,lng.
  const url = new URL(`${base}/query`);
  url.searchParams.set('geometry', `${lng},${lat}`);
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', 'SA2_CODE_2021,SA2_NAME_2021');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');

  let raw: unknown;
  try {
    raw = await pRetry(
      async () => {
        const res = await fetch(url.toString());
        if (!res.ok) {
          if (RETRYABLE_STATUS.has(res.status)) {
            throw new Error(`ABS SA2 ArcGIS HTTP ${res.status}`);
          }
          throw new AbortError(`ABS SA2 ArcGIS non-retryable HTTP ${res.status}`);
        }
        return (await res.json()) as unknown;
      },
      {
        retries: 3,
        minTimeout: 500,
        maxTimeout: 8_000,
        factor: 2,
        onFailedAttempt: (e) =>
          logger.warn(
            { lat, lng, attempt: e.attemptNumber, retriesLeft: e.retriesLeft },
            'abs sa2 fetch retry',
          ),
      },
    );
  } catch (err) {
    logger.warn({ lat, lng, err }, 'abs resolveSa2 fetch failed — returning null');
    return null;
  }

  const parsed = Sa2QueryResponseSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ lat, lng, issues: parsed.error.issues }, 'abs resolveSa2 schema mismatch');
    return null;
  }

  const first = parsed.data.features[0];
  if (!first) {
    // Point is outside all SA2 polygons (e.g. ocean).
    return null;
  }

  return {
    sa2Code: first.attributes.sa2_code_2021,
    sa2Name: first.attributes.sa2_name_2021,
  };
}
