// tests/unit/abs-sa2.test.ts
// MSW 2.6 tests for resolveSa2.
// Covers: geometry lng,lat order; SA2 code/name parsing; empty features→null;
// 5xx→null (degrade, never throw).

import { resolveSa2 } from '@/tools/abs/sa2';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

// We use a custom base so the test doesn't touch the real ABS service.
const BASE = 'http://abs-asgs-test.local/arcgis/rest/services/ASGS2021/SA2/MapServer/0';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  process.env.ABS_ASGS_BASE = BASE;
});

// ---------------------------------------------------------------------------
// Fixtures — Mosman SA2 (live-probed 2026-06-01)
// The ArcGIS service returns lowercase attribute keys.
// ---------------------------------------------------------------------------

const MOSMAN_SA2_RESPONSE = {
  features: [
    {
      attributes: {
        sa2_code_2021: '121041688',
        sa2_name_2021: 'Mosman',
      },
    },
  ],
};

const EMPTY_FEATURES = { features: [] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleQuery(body: object, captureUrl?: (url: URL) => void) {
  return http.get(`${BASE}/query`, ({ request }) => {
    captureUrl?.(new URL(request.url));
    return HttpResponse.json(body);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveSa2 — geometry parameter order', () => {
  it('sends geometry as lng,lat (X,Y) — NOT lat,lng', async () => {
    let captured: URL | undefined;

    server.use(
      handleQuery(MOSMAN_SA2_RESPONSE, (u) => {
        captured = u;
      }),
    );

    const lat = -33.8329;
    const lng = 151.2432;
    await resolveSa2(lat, lng);

    expect(captured).toBeDefined();
    // geometry must be <lng>,<lat> — X,Y order
    expect(captured!.searchParams.get('geometry')).toBe(`${lng},${lat}`);
  });

  it('includes the expected query params', async () => {
    let captured: URL | undefined;

    server.use(
      handleQuery(MOSMAN_SA2_RESPONSE, (u) => {
        captured = u;
      }),
    );

    await resolveSa2(-33.8329, 151.2432);

    const p = captured!.searchParams;
    expect(p.get('geometryType')).toBe('esriGeometryPoint');
    expect(p.get('inSR')).toBe('4326');
    expect(p.get('spatialRel')).toBe('esriSpatialRelIntersects');
    expect(p.get('returnGeometry')).toBe('false');
    expect(p.get('f')).toBe('json');
    // outFields must include the two SA2 fields
    const outFields = p.get('outFields') ?? '';
    expect(outFields).toContain('SA2_CODE_2021');
    expect(outFields).toContain('SA2_NAME_2021');
  });
});

describe('resolveSa2 — response parsing', () => {
  it('returns sa2Code and sa2Name from the first feature', async () => {
    server.use(handleQuery(MOSMAN_SA2_RESPONSE));

    const result = await resolveSa2(-33.8329, 151.2432);

    expect(result).not.toBeNull();
    expect(result!.sa2Code).toBe('121041688');
    expect(result!.sa2Name).toBe('Mosman');
  });

  it('returns null when features array is empty (point outside all SA2s)', async () => {
    server.use(handleQuery(EMPTY_FEATURES));

    const result = await resolveSa2(-90, 0); // south pole — no SA2

    expect(result).toBeNull();
  });
});

describe('resolveSa2 — degradation on error', () => {
  it('returns null (does not throw) when the service responds 5xx', async () => {
    // pRetry will exhaust its retries then reject; resolveSa2 catches → null.
    server.use(
      http.get(`${BASE}/query`, () =>
        HttpResponse.json({ error: 'internal error' }, { status: 503 }),
      ),
    );

    const result = await resolveSa2(-33.8329, 151.2432);

    expect(result).toBeNull();
  }, 30_000); // generous timeout — pRetry has backoff

  it('returns null (does not throw) when the response has an unexpected shape', async () => {
    server.use(handleQuery({ totally: 'wrong' }));

    const result = await resolveSa2(-33.8329, 151.2432);

    expect(result).toBeNull();
  });
});
