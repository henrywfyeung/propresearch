// tests/unit/vic-risk-wfs.test.ts
// MSW 2.6 tests for the generic Vicmap WFS point-query client (wfs.ts).
//
// Covers:
//   - URL built with POINT(lat lng) — lat FIRST (the critical axis gotcha)
//   - propertyName forwarded as a query param
//   - cqlExtra appended with " AND "
//   - features[].properties parsed + returned
//   - empty features[] → []
//   - non-JSON (XML ServiceException) body → SchemaDriftError
//   - 5xx retryable path eventually throws

import { SchemaDriftError } from '@/lib/errors';
import { vicWfsPointQuery } from '@/tools/vic-risk/wfs';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const WFS_BASE = 'http://vicmap-test.local/geoserver/wfs';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  process.env.VIC_VICMAP_WFS = WFS_BASE;
});

// ---------------------------------------------------------------------------
// Schema fixture
// ---------------------------------------------------------------------------

const TestPropsSchema = z.object({
  scheme_code: z.string(),
  zone_description: z.string().nullable().optional(),
});
type TestProps = z.infer<typeof TestPropsSchema>;

// ---------------------------------------------------------------------------
// Response fixtures — based on live Vicmap samples (spec §5)
// ---------------------------------------------------------------------------

/** Maribyrnong LSIO — Land Subject to Inundation Overlay */
const LSIO_FEATURE_RESPONSE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        scheme_code: 'LSIO',
        zone_description: 'Land Subject to Inundation Overlay',
      },
    },
  ],
};

/** Two overlays: FO (high) + LSIO (medium) */
const TWO_FEATURE_RESPONSE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        scheme_code: 'LSIO',
        zone_description: 'Land Subject to Inundation Overlay',
      },
    },
    {
      type: 'Feature',
      properties: {
        scheme_code: 'FO',
        zone_description: 'Floodway Overlay',
      },
    },
  ],
};

/** Empty result — no overlay at this point */
const EMPTY_RESPONSE = {
  type: 'FeatureCollection',
  features: [],
};

/** XML ServiceException — the bad-field-name case */
const XML_SERVICE_EXCEPTION =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<ServiceExceptionReport>' +
  "<ServiceException>Unknown property name 'bad_field'.</ServiceException>" +
  '</ServiceExceptionReport>';

// ---------------------------------------------------------------------------
// Helper: intercept GET to WFS_BASE (all params in query string)
// ---------------------------------------------------------------------------

function handleWfs(body: object | string, status = 200, captureUrl?: (url: URL) => void) {
  return http.get(WFS_BASE, ({ request }) => {
    captureUrl?.(new URL(request.url));
    if (typeof body === 'string') {
      return new HttpResponse(body, {
        status,
        headers: { 'Content-Type': 'text/xml' },
      });
    }
    return HttpResponse.json(body, { status });
  });
}

// ---------------------------------------------------------------------------
// Tests: URL construction
// ---------------------------------------------------------------------------

describe('vicWfsPointQuery — URL construction', () => {
  it('places lat FIRST in POINT(lat lng) — the critical axis gotcha', async () => {
    let captured: URL | undefined;
    server.use(
      handleWfs(LSIO_FEATURE_RESPONSE, 200, (u) => {
        captured = u;
      }),
    );

    await vicWfsPointQuery(
      {
        typeName: 'open-data-platform:plan_overlay',
        lat: -37.7965,
        lng: 144.9125,
        propertyName: 'scheme_code,zone_description',
      },
      TestPropsSchema,
    );

    expect(captured).toBeDefined();
    const cql = captured!.searchParams.get('CQL_FILTER');
    expect(cql).toContain('POINT(-37.7965 144.9125)');
    // Verify it is NOT the wrong lng-lat order
    expect(cql).not.toContain('POINT(144.9125 -37.7965)');
  });

  it('forwards propertyName as a query parameter', async () => {
    let captured: URL | undefined;
    server.use(
      handleWfs(LSIO_FEATURE_RESPONSE, 200, (u) => {
        captured = u;
      }),
    );

    await vicWfsPointQuery(
      {
        typeName: 'open-data-platform:plan_overlay',
        lat: -37.7965,
        lng: 144.9125,
        propertyName: 'scheme_code,zone_description',
      },
      TestPropsSchema,
    );

    expect(captured!.searchParams.get('propertyName')).toBe('scheme_code,zone_description');
  });

  it('sets required WFS params: service, version, request, typeNames, outputFormat', async () => {
    let captured: URL | undefined;
    server.use(
      handleWfs(LSIO_FEATURE_RESPONSE, 200, (u) => {
        captured = u;
      }),
    );

    await vicWfsPointQuery(
      {
        typeName: 'open-data-platform:plan_overlay',
        lat: -37.7965,
        lng: 144.9125,
        propertyName: 'scheme_code',
      },
      TestPropsSchema,
    );

    const p = captured!.searchParams;
    expect(p.get('service')).toBe('WFS');
    expect(p.get('version')).toBe('2.0.0');
    expect(p.get('request')).toBe('GetFeature');
    expect(p.get('typeNames')).toBe('open-data-platform:plan_overlay');
    expect(p.get('outputFormat')).toBe('application/json');
  });

  it('appends cqlExtra with " AND " when provided', async () => {
    let captured: URL | undefined;
    server.use(
      handleWfs(LSIO_FEATURE_RESPONSE, 200, (u) => {
        captured = u;
      }),
    );

    await vicWfsPointQuery(
      {
        typeName: 'open-data-platform:plan_overlay',
        lat: -37.7965,
        lng: 144.9125,
        propertyName: 'scheme_code',
        cqlExtra: "scheme_code IN ('LSIO','FO','SBO')",
      },
      TestPropsSchema,
    );

    const cql = captured!.searchParams.get('CQL_FILTER');
    expect(cql).toContain("AND scheme_code IN ('LSIO','FO','SBO')");
    // The POINT filter must still be present
    expect(cql).toContain('INTERSECTS(geom, POINT(');
  });

  it('does not append AND when cqlExtra is absent', async () => {
    let captured: URL | undefined;
    server.use(
      handleWfs(LSIO_FEATURE_RESPONSE, 200, (u) => {
        captured = u;
      }),
    );

    await vicWfsPointQuery(
      {
        typeName: 'open-data-platform:plan_overlay',
        lat: -37.7965,
        lng: 144.9125,
        propertyName: 'scheme_code',
      },
      TestPropsSchema,
    );

    const cql = captured!.searchParams.get('CQL_FILTER');
    expect(cql).not.toContain(' AND ');
  });
});

// ---------------------------------------------------------------------------
// Tests: response parsing
// ---------------------------------------------------------------------------

describe('vicWfsPointQuery — response parsing', () => {
  it('returns properties[] from features[]', async () => {
    server.use(handleWfs(TWO_FEATURE_RESPONSE));

    const results: TestProps[] = await vicWfsPointQuery(
      {
        typeName: 'open-data-platform:plan_overlay',
        lat: -37.7965,
        lng: 144.9125,
        propertyName: 'scheme_code,zone_description',
      },
      TestPropsSchema,
    );

    expect(results).toHaveLength(2);
    expect(results[0]?.scheme_code).toBe('LSIO');
    expect(results[1]?.scheme_code).toBe('FO');
  });

  it('returns [] when features array is empty', async () => {
    server.use(handleWfs(EMPTY_RESPONSE));

    const results = await vicWfsPointQuery(
      {
        typeName: 'open-data-platform:plan_overlay',
        lat: -37.7965,
        lng: 144.9125,
        propertyName: 'scheme_code',
      },
      TestPropsSchema,
    );

    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: error handling
// ---------------------------------------------------------------------------

describe('vicWfsPointQuery — error handling', () => {
  it('throws SchemaDriftError when the response body is not JSON (XML ServiceException)', async () => {
    server.use(handleWfs(XML_SERVICE_EXCEPTION));

    await expect(
      vicWfsPointQuery(
        {
          typeName: 'open-data-platform:plan_overlay',
          lat: -37.7965,
          lng: 144.9125,
          propertyName: 'bad_field',
        },
        TestPropsSchema,
      ),
    ).rejects.toThrow(SchemaDriftError);
  });

  it('throws SchemaDriftError when JSON does not match the envelope schema', async () => {
    // Plausible JSON but wrong shape (e.g. ArcGIS error body)
    server.use(handleWfs({ error: { code: 400, message: 'bad request' } }));

    await expect(
      vicWfsPointQuery(
        {
          typeName: 'open-data-platform:plan_overlay',
          lat: -37.7965,
          lng: 144.9125,
          propertyName: 'scheme_code',
        },
        TestPropsSchema,
      ),
    ).rejects.toThrow(SchemaDriftError);
  });

  it('throws on persistent 5xx after retries', async () => {
    server.use(handleWfs({ error: 'internal' }, 503));

    await expect(
      vicWfsPointQuery(
        {
          typeName: 'open-data-platform:plan_overlay',
          lat: -37.7965,
          lng: 144.9125,
          propertyName: 'scheme_code',
        },
        TestPropsSchema,
      ),
    ).rejects.toThrow();
  }, 30_000); // generous timeout — pRetry has backoff
});
