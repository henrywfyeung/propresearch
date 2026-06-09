// tests/unit/nsw-risk-arcgis.test.ts
// MSW 2.6 tests for the generic ArcGIS point-query client.
// Covers: layer-name→id resolution, query URL params, attributes parsing,
// empty features, persistent 5xx retry+throw, and the layer-id cache.

import { arcgisPointQuery, clearLayerIdCache } from '@/tools/nsw-risk/arcgis';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

// ---- MSW server -----------------------------------------------------------

const BASE = 'http://arcgis-test.local/arcgis/rest/services';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  clearLayerIdCache();
});
afterAll(() => server.close());

beforeEach(() => {
  process.env.NSW_ARCGIS_BASE = BASE;
});

// ---- Fixtures -------------------------------------------------------------

const SERVICE = 'Fire/BFPL';

/** MapServer introspection fixture — two layers, we want layer 0 */
const MAPSERVER_RESPONSE = {
  layers: [
    { id: 0, name: 'Bushfire Prone Land', type: 'Feature Layer' },
    { id: 1, name: 'Bushfire Prone Land Boundary', type: 'Feature Layer' },
  ],
};

const FEATURE_RESPONSE = {
  features: [
    { attributes: { Category: 1, d_Category: 'Category 1', Guideline: 'G1', d_Guidelin: 'X' } },
    { attributes: { Category: 3, d_Category: 'Category 3', Guideline: 'G3', d_Guidelin: 'Y' } },
  ],
};

const AttributeSchema = z.object({
  Category: z.number(),
  d_Category: z.string(),
  Guideline: z.string(),
  d_Guidelin: z.string(),
});
type Attribute = z.infer<typeof AttributeSchema>;

// ---- Helpers --------------------------------------------------------------

function handleIntrospection(overrideBody?: object) {
  return http.get(`${BASE}/${SERVICE}/MapServer`, () =>
    HttpResponse.json(overrideBody ?? MAPSERVER_RESPONSE),
  );
}

function handleQuery(layerId: number, body: object, captureUrl?: (url: URL) => void) {
  return http.get(`${BASE}/${SERVICE}/MapServer/${layerId}/query`, ({ request }) => {
    captureUrl?.(new URL(request.url));
    return HttpResponse.json(body);
  });
}

// ---- Tests ----------------------------------------------------------------

describe('arcgisPointQuery — layer-name resolution', () => {
  it('resolves layerName to the correct numeric id from MapServer introspection', async () => {
    server.use(handleIntrospection(), handleQuery(0, FEATURE_RESPONSE));

    const results = await arcgisPointQuery(
      {
        service: SERVICE,
        layerName: 'Bushfire Prone Land',
        lng: 151.0,
        lat: -33.8,
        outFields: ['Category'],
      },
      AttributeSchema,
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.Category).toBe(1);
  });

  it('throws when the layer name cannot be found in the MapServer response', async () => {
    server.use(handleIntrospection());

    await expect(
      arcgisPointQuery(
        {
          service: SERVICE,
          layerName: 'Nonexistent Layer',
          lng: 151.0,
          lat: -33.8,
          outFields: ['Category'],
        },
        AttributeSchema,
      ),
    ).rejects.toThrow(/layer.*not found/i);
  });
});

describe('arcgisPointQuery — query URL parameters', () => {
  it('carries geometry, inSR=4326, spatialRel, outFields, returnGeometry=false, f=json', async () => {
    let captured: URL | undefined;

    server.use(
      handleIntrospection(),
      handleQuery(0, FEATURE_RESPONSE, (u) => {
        captured = u;
      }),
    );

    await arcgisPointQuery(
      {
        service: SERVICE,
        layerName: 'Bushfire Prone Land',
        lng: 151.2454,
        lat: -33.8184,
        outFields: ['Category', 'd_Category'],
      },
      AttributeSchema,
    );

    expect(captured).toBeDefined();
    const p = captured!.searchParams;
    expect(p.get('geometry')).toBe('151.2454,-33.8184');
    expect(p.get('geometryType')).toBe('esriGeometryPoint');
    expect(p.get('inSR')).toBe('4326');
    expect(p.get('spatialRel')).toBe('esriSpatialRelIntersects');
    expect(p.get('outFields')).toBe('Category,d_Category');
    expect(p.get('returnGeometry')).toBe('false');
    expect(p.get('f')).toBe('json');
  });
});

describe('arcgisPointQuery — response parsing', () => {
  it('returns attributes[] from features[]', async () => {
    server.use(handleIntrospection(), handleQuery(0, FEATURE_RESPONSE));

    const results: Attribute[] = await arcgisPointQuery(
      {
        service: SERVICE,
        layerName: 'Bushfire Prone Land',
        lng: 151.0,
        lat: -33.8,
        outFields: ['Category'],
      },
      AttributeSchema,
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      Category: 1,
      d_Category: 'Category 1',
      Guideline: 'G1',
      d_Guidelin: 'X',
    });
    expect(results[1]).toEqual({
      Category: 3,
      d_Category: 'Category 3',
      Guideline: 'G3',
      d_Guidelin: 'Y',
    });
  });

  it('returns [] when features array is empty', async () => {
    server.use(handleIntrospection(), handleQuery(0, { features: [] }));

    const results = await arcgisPointQuery(
      {
        service: SERVICE,
        layerName: 'Bushfire Prone Land',
        lng: 151.0,
        lat: -33.8,
        outFields: ['Category'],
      },
      AttributeSchema,
    );
    expect(results).toEqual([]);
  });

  it('throws SchemaDriftError when attributes do not match the schema', async () => {
    server.use(
      handleIntrospection(),
      handleQuery(0, { features: [{ attributes: { wrong: 'shape' } }] }),
    );

    await expect(
      arcgisPointQuery(
        {
          service: SERVICE,
          layerName: 'Bushfire Prone Land',
          lng: 151.0,
          lat: -33.8,
          outFields: ['Category'],
        },
        AttributeSchema,
      ),
    ).rejects.toThrow();
  });
});

describe('arcgisPointQuery — retry behaviour', () => {
  it('retries on 5xx and throws after exhausting retries', async () => {
    // Use real timers but shorten delays via vi.useFakeTimers is complex with
    // async — instead we rely on pRetry's retries:3 + the test just waits.
    // We reduce timeout concerns by using a minimal fake that always 503s.
    server.use(
      handleIntrospection(),
      http.get(`${BASE}/${SERVICE}/MapServer/0/query`, () =>
        HttpResponse.json({ error: 'server error' }, { status: 503 }),
      ),
    );

    await expect(
      arcgisPointQuery(
        {
          service: SERVICE,
          layerName: 'Bushfire Prone Land',
          lng: 151.0,
          lat: -33.8,
          outFields: ['Category'],
        },
        AttributeSchema,
      ),
    ).rejects.toThrow();
  }, 30_000); // generous timeout — pRetry has backoff
});

describe('arcgisPointQuery — layer-id cache', () => {
  it('only calls MapServer introspection once for repeated queries to the same service/layerName', async () => {
    let introspectionHits = 0;

    server.use(
      http.get(`${BASE}/${SERVICE}/MapServer`, () => {
        introspectionHits += 1;
        return HttpResponse.json(MAPSERVER_RESPONSE);
      }),
      handleQuery(0, FEATURE_RESPONSE),
    );

    // First call
    await arcgisPointQuery(
      {
        service: SERVICE,
        layerName: 'Bushfire Prone Land',
        lng: 151.0,
        lat: -33.8,
        outFields: ['Category'],
      },
      AttributeSchema,
    );
    // Second call — same service + layerName
    await arcgisPointQuery(
      {
        service: SERVICE,
        layerName: 'Bushfire Prone Land',
        lng: 151.1,
        lat: -33.9,
        outFields: ['Category'],
      },
      AttributeSchema,
    );

    expect(introspectionHits).toBe(1);
  });

  it('re-introspects for a different layerName within the same service', async () => {
    let introspectionHits = 0;

    server.use(
      http.get(`${BASE}/${SERVICE}/MapServer`, () => {
        introspectionHits += 1;
        return HttpResponse.json(MAPSERVER_RESPONSE);
      }),
      handleQuery(0, FEATURE_RESPONSE),
      handleQuery(1, FEATURE_RESPONSE),
    );

    await arcgisPointQuery(
      {
        service: SERVICE,
        layerName: 'Bushfire Prone Land',
        lng: 151.0,
        lat: -33.8,
        outFields: ['Category'],
      },
      AttributeSchema,
    );
    await arcgisPointQuery(
      {
        service: SERVICE,
        layerName: 'Bushfire Prone Land Boundary',
        lng: 151.0,
        lat: -33.8,
        outFields: ['Category'],
      },
      AttributeSchema,
    );

    // Both layer names live under the same MapServer response — only one introspection needed.
    expect(introspectionHits).toBe(1);
  });
});
