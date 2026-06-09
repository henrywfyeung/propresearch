// tests/unit/nsw-risk-lga.test.ts
// MSW 2.6 tests for the LGA-boundary resolver.
//
// resolveLga queries Common/Admin_3857/MapServer/1 (keyless NSW SEED host),
// returns LGANAME (uppercase) or null on no intersect.
//
// Layer discovered 2026-06-01:
//   https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Common/Admin_3857/MapServer/1
//   Layer name: "Local Government Area", field: LGANAME (string, uppercase)

import { clearLayerIdCache } from '@/tools/nsw-risk/arcgis';
import { resolveLga } from '@/tools/nsw-risk/lga';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const BASE = 'http://arcgis-test.local/arcgis/rest/services';
const SERVICE = 'Common/Admin_3857';
const LAYER_ID = 1;

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

// ---------------------------------------------------------------------------
// Fixtures — sampled from live layer
// ---------------------------------------------------------------------------

const ADMIN_MAPSERVER = {
  layers: [
    { id: 0, name: 'Administration', type: 'Feature Layer' },
    { id: 1, name: 'Local Government Area', type: 'Feature Layer' },
    { id: 2, name: 'Suburb', type: 'Feature Layer' },
  ],
};

const WOLLONGONG_FEATURE = {
  features: [{ attributes: { LGANAME: 'WOLLONGONG' } }],
};

const HORNSBY_FEATURE = {
  features: [{ attributes: { LGANAME: 'HORNSBY' } }],
};

const MOSMAN_FEATURE = {
  features: [{ attributes: { LGANAME: 'MOSMAN' } }],
};

const EMPTY_FEATURES = { features: [] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleIntrospection() {
  return http.get(`${BASE}/${SERVICE}/MapServer`, () => HttpResponse.json(ADMIN_MAPSERVER));
}

function handleLgaQuery(body: object) {
  return http.get(`${BASE}/${SERVICE}/MapServer/${LAYER_ID}/query`, () => HttpResponse.json(body));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveLga — returns LGANAME for known NSW addresses', () => {
  it('returns WOLLONGONG (uppercase) for a Wollongong coordinate', async () => {
    server.use(handleIntrospection(), handleLgaQuery(WOLLONGONG_FEATURE));

    const lga = await resolveLga(-34.424, 150.893);

    expect(lga).toBe('WOLLONGONG');
  });

  it('returns HORNSBY for a Hornsby coordinate', async () => {
    server.use(handleIntrospection(), handleLgaQuery(HORNSBY_FEATURE));

    const lga = await resolveLga(-33.702, 151.095);

    expect(lga).toBe('HORNSBY');
  });

  it('returns MOSMAN for a Mosman coordinate', async () => {
    server.use(handleIntrospection(), handleLgaQuery(MOSMAN_FEATURE));

    const lga = await resolveLga(-33.8308, 151.2428);

    expect(lga).toBe('MOSMAN');
  });
});

describe('resolveLga — null on no intersect', () => {
  it('returns null when the point is outside NSW (no features)', async () => {
    server.use(handleIntrospection(), handleLgaQuery(EMPTY_FEATURES));

    const lga = await resolveLga(-37.8136, 144.9631); // Melbourne

    expect(lga).toBeNull();
  });
});
