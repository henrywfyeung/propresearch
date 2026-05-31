// src/tools/nsw-risk/arcgis.ts
// Generic ArcGIS REST point-query client for the NSW DCCEEW/SEED host.
// Used by the per-category risk adapters (bushfire, heritage, flood).
//
// Pattern mirrors src/tools/rapidapi/client.ts:
//   pRetry on 429/5xx, AbortError on non-retryable codes, Zod validation at
//   the boundary, SchemaDriftError on parse failure.
//
// Layer-name→id resolution: each service's numeric layer IDs can shift on
// republish; we pin by name (spec §1 "robustness"). The resolved id is
// cached in a module-level Map keyed by `{service}/{layerName}` so repeated
// calls within a process don't re-introspect.

import { SchemaDriftError } from '@/lib/errors';
import { logger } from '@/lib/observability/logger';
import pRetry, { AbortError } from 'p-retry';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

function arcgisBase(): string {
  return (
    process.env.NSW_ARCGIS_BASE ?? 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services'
  );
}

// ---------------------------------------------------------------------------
// Layer-id cache
// ---------------------------------------------------------------------------

// Key: `${service}/${layerName}`, Value: numeric layer id.
// One Map covers the whole process; cleared between tests via clearLayerIdCache().
const layerIdCache = new Map<string, number>();

/** Exported for tests — clears the in-process cache between test cases. */
export function clearLayerIdCache(): void {
  layerIdCache.clear();
}

// ---------------------------------------------------------------------------
// MapServer introspection schemas
// ---------------------------------------------------------------------------

const MapServerLayerSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const MapServerResponseSchema = z.object({
  layers: z.array(MapServerLayerSchema),
});

// ---------------------------------------------------------------------------
// Retryable statuses (mirrors rapidApiCall)
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// ---------------------------------------------------------------------------
// Core fetch helper — wraps pRetry + Zod
// ---------------------------------------------------------------------------

async function fetchJson(url: string): Promise<unknown> {
  return pRetry(
    async () => {
      const res = await fetch(url);
      if (!res.ok) {
        if (RETRYABLE_STATUS.has(res.status)) {
          throw new Error(`ArcGIS HTTP ${res.status}: ${url}`);
        }
        throw new AbortError(`ArcGIS non-retryable HTTP ${res.status}: ${url}`);
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
          { url, attempt: e.attemptNumber, retriesLeft: e.retriesLeft },
          'arcgis fetch retry',
        ),
    },
  );
}

// ---------------------------------------------------------------------------
// Layer-id resolution (cached)
// ---------------------------------------------------------------------------

async function resolveLayerId(service: string, layerName: string): Promise<number> {
  const cacheKey = `${service}/${layerName}`;
  const cached = layerIdCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const base = arcgisBase();
  const url = `${base}/${service}/MapServer?f=json`;

  const raw = await fetchJson(url);

  const parsed = MapServerResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SchemaDriftError(`ArcGIS MapServer introspection failed for ${service}`, {
      service,
      issues: parsed.error.issues,
    });
  }

  const layer = parsed.data.layers.find((l) => l.name === layerName);
  if (!layer) {
    throw new Error(
      `ArcGIS layer not found: "${layerName}" in service "${service}". ` +
        `Available layers: ${parsed.data.layers.map((l) => l.name).join(', ')}`,
    );
  }

  // Cache the whole service response so other layer names from the same
  // MapServer also benefit — they'll hit the same cache without re-fetching.
  for (const l of parsed.data.layers) {
    layerIdCache.set(`${service}/${l.name}`, l.id);
  }

  return layer.id;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ArcgisPointQueryOpts {
  /** Service path relative to the base URL, e.g. "Fire/BFPL". */
  service: string;
  /** Exact layer name as it appears in MapServer?f=json → layers[].name. */
  layerName: string;
  /** WGS84 longitude. */
  lng: number;
  /** WGS84 latitude. */
  lat: number;
  /** Fields to include in the response, e.g. ["Category", "d_Category"]. */
  outFields: string[];
}

/** Query ArcGIS attributes response envelope. */
const ArcgisQueryResponseSchema = <T extends z.ZodTypeAny>(attrSchema: T) =>
  z.object({
    features: z.array(z.object({ attributes: attrSchema })),
  });

/**
 * Point-intersect query against an ArcGIS MapServer layer.
 *
 * Resolves `layerName` to a numeric layer id (cached per process), issues a
 * GET query with `geometry=lng,lat&inSR=4326&spatialRel=esriSpatialRelIntersects`,
 * Zod-validates each feature's `attributes` against `schema`, and returns the
 * attributes array.
 *
 * Returns `[]` when no features intersect the point.
 */
export async function arcgisPointQuery<T>(
  opts: ArcgisPointQueryOpts,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const { service, layerName, lng, lat, outFields } = opts;
  const base = arcgisBase();

  const layerId = await resolveLayerId(service, layerName);

  const url = new URL(`${base}/${service}/MapServer/${layerId}/query`);
  url.searchParams.set('geometry', `${lng},${lat}`);
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', outFields.join(','));
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');

  const raw = await fetchJson(url.toString());

  // Validate the outer envelope
  const envelopeSchema = ArcgisQueryResponseSchema(schema);
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SchemaDriftError(
      `ArcGIS query response failed validation for ${service}/${layerName}`,
      { service, layerName, issues: parsed.error.issues },
    );
  }

  return parsed.data.features.map((f) => f.attributes as T);
}
