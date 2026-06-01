// src/tools/vic-risk/wfs.ts
// Generic WFS 2.0 point-query client for the DEECA Vicmap GeoServer.
// Used by the per-category VIC risk adapters (flood, bushfire, heritage).
//
// CRITICAL axis gotcha (spec §1 / design §1):
//   CQL_FILTER is INTERSECTS(geom, POINT(<lat> <lng>)) — **lat THEN lng** (Y X
//   order), with NO srsName. The usual lng-lat order silently returns 0 features
//   (HTTP 200). Always pass propertyName (no geom) or responses balloon to
//   multi-MB polygons. A bad propertyName field → an XML ServiceException, NOT
//   JSON → parse defensively → throw SchemaDriftError.
//
// Mirrors arcgis.ts style: pRetry on 429/5xx, Zod at the boundary,
// SchemaDriftError on parse failure.

import { SchemaDriftError } from '@/lib/errors';
import { logger } from '@/lib/observability/logger';
import pRetry, { AbortError } from 'p-retry';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

function vicWfsBase(): string {
  return process.env.VIC_VICMAP_WFS ?? 'https://opendata.maps.vic.gov.au/geoserver/wfs';
}

// ---------------------------------------------------------------------------
// Retryable statuses (mirrors arcgis.ts)
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// ---------------------------------------------------------------------------
// WFS response envelope schema
// ---------------------------------------------------------------------------

const WfsFeatureSchema = <T extends z.ZodTypeAny>(propsSchema: T) =>
  z.object({
    features: z.array(z.object({ properties: propsSchema })),
  });

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VicWfsPointQueryOpts {
  /** WFS typeNames value, e.g. "open-data-platform:plan_overlay". */
  typeName: string;
  /** WGS84 latitude — passed FIRST in POINT(lat lng). */
  lat: number;
  /** WGS84 longitude — passed SECOND in POINT(lat lng). */
  lng: number;
  /**
   * Comma-separated field names to include.
   * NEVER include the geometry column — responses balloon to multi-MB polygons.
   * A bad field name → XML ServiceException → SchemaDriftError.
   */
  propertyName: string;
  /**
   * Optional extra CQL predicate appended with " AND ".
   * Example: "scheme_code IN ('LSIO','FO','SBO')"
   */
  cqlExtra?: string;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Point-intersect query against the DEECA Vicmap GeoServer WFS.
 *
 * Builds: `INTERSECTS(geom, POINT(<lat> <lng>))` — lat THEN lng (Y X order).
 *
 * Returns an array of validated `properties` objects.
 * Returns `[]` when no features intersect the point (this is NOT missing data —
 * the WFS is statewide; empty means no overlay at this location).
 *
 * Throws `SchemaDriftError` when the response is not valid JSON (the WFS
 * returns an XML ServiceException for bad field names — see module JSDoc).
 */
export async function vicWfsPointQuery<T>(
  opts: VicWfsPointQueryOpts,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const base = vicWfsBase();

  // Build lat-FIRST POINT filter (the critical axis gotcha)
  const cqlFilter = `INTERSECTS(geom, POINT(${opts.lat} ${opts.lng}))${
    opts.cqlExtra ? ` AND ${opts.cqlExtra}` : ''
  }`;

  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: opts.typeName,
    outputFormat: 'application/json',
    propertyName: opts.propertyName,
    CQL_FILTER: cqlFilter,
  });

  const url = `${base}?${params.toString()}`;

  const raw: unknown = await pRetry(
    async () => {
      const res = await fetch(url);
      if (!res.ok) {
        if (RETRYABLE_STATUS.has(res.status)) {
          throw new Error(`Vicmap WFS HTTP ${res.status}: ${opts.typeName}`);
        }
        throw new AbortError(`Vicmap WFS non-retryable HTTP ${res.status}: ${opts.typeName}`);
      }

      // Read as text first — a bad propertyName returns XML, not JSON.
      const text = await res.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        // XML ServiceException or other non-JSON body
        throw new AbortError(
          new SchemaDriftError(
            `Vicmap WFS returned non-JSON response for typeName=${opts.typeName}. ` +
              `Likely a bad propertyName field. Body (first 200 chars): ${text.slice(0, 200)}`,
            { typeName: opts.typeName, propertyName: opts.propertyName },
          ),
        );
      }
    },
    {
      retries: 3,
      minTimeout: 500,
      maxTimeout: 8_000,
      factor: 2,
      onFailedAttempt: (e) =>
        logger.warn(
          { url, attempt: e.attemptNumber, retriesLeft: e.retriesLeft },
          'vicmap wfs fetch retry',
        ),
    },
  );

  // Validate the outer GeoJSON-like envelope
  const envelopeSchema = WfsFeatureSchema(schema);
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SchemaDriftError(
      `Vicmap WFS response failed validation for typeName=${opts.typeName}`,
      { typeName: opts.typeName, issues: parsed.error.issues },
    );
  }

  return parsed.data.features.map((f) => f.properties as T);
}
