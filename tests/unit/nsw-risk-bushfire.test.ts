// tests/unit/nsw-risk-bushfire.test.ts
// MSW 2.6 tests for the bushfire risk adapter.
// Covers: Category 1→high, Category 3→medium, Category 2→low,
// most-severe-wins across multiple features, empty→null.

import { clearLayerIdCache } from '@/tools/nsw-risk/arcgis';
import { queryBushfire } from '@/tools/nsw-risk/bushfire';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const BASE = 'http://arcgis-test.local/arcgis/rest/services';
const SERVICE = 'Fire/BFPL';
const LAYER_ID = 0;

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
// Fixtures — sampled from live layer (spec §1)
// ---------------------------------------------------------------------------

/** MapServer introspection for BFPL */
const BFPL_MAPSERVER = {
  layers: [{ id: 0, name: 'NSW Bush Fire Prone Lands', type: 'Feature Layer' }],
};

/** Category 1 — highest severity (Vegetation Category 1) */
const SINGLE_CAT1_FEATURE = {
  features: [
    {
      attributes: {
        Category: 1,
        d_Category: 'Vegetation Category 1',
        Guideline: 1,
        d_Guidelin: 'Planning for Bushfire Protection 2019',
      },
    },
  ],
};

/** Category 3 — medium severity (Vegetation Category 3) */
const SINGLE_CAT3_FEATURE = {
  features: [
    {
      attributes: {
        Category: 3,
        d_Category: 'Vegetation Category 3',
        Guideline: 1,
        d_Guidelin: 'Planning for Bushfire Protection 2019',
      },
    },
  ],
};

/** Category 2 — low severity (Vegetation Category 2) */
const SINGLE_CAT2_FEATURE = {
  features: [
    {
      attributes: {
        Category: 2,
        d_Category: 'Vegetation Category 2',
        Guideline: 1,
        d_Guidelin: 'Planning for Bushfire Protection 2019',
      },
    },
  ],
};

/** Multiple features: Cat 3 and Cat 1 — most severe (Cat 1 → high) should win */
const MULTI_CAT3_AND_CAT1 = {
  features: [
    {
      attributes: {
        Category: 3,
        d_Category: 'Vegetation Category 3',
        Guideline: 1,
        d_Guidelin: 'Planning for Bushfire Protection 2019',
      },
    },
    {
      attributes: {
        Category: 1,
        d_Category: 'Vegetation Category 1',
        Guideline: 1,
        d_Guidelin: 'Planning for Bushfire Protection 2019',
      },
    },
  ],
};

/** Category 0 — buffer/adjacency → 'low' */
const SINGLE_CAT0_FEATURE = {
  features: [
    {
      attributes: {
        Category: 0,
        d_Category: 'Buffer Zone',
        Guideline: 0,
        d_Guidelin: 'Buffer',
      },
    },
  ],
};

/** Empty features — not on bushfire-prone land */
const EMPTY_FEATURES = { features: [] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleBfplIntrospection() {
  return http.get(`${BASE}/${SERVICE}/MapServer`, () => HttpResponse.json(BFPL_MAPSERVER));
}

function handleBfplQuery(body: object) {
  return http.get(`${BASE}/${SERVICE}/MapServer/${LAYER_ID}/query`, () => HttpResponse.json(body));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('queryBushfire — severity mapping', () => {
  it('Category 1 → severity high, correct description and evidence', async () => {
    server.use(handleBfplIntrospection(), handleBfplQuery(SINGLE_CAT1_FEATURE));

    const flag = await queryBushfire(-33.8184, 151.2454);

    expect(flag).not.toBeNull();
    expect(flag!.category).toBe('bushfire');
    expect(flag!.severity).toBe('high');
    expect(flag!.description).toBe('Vegetation Category 1');
    expect(flag!.dataAvailable).toBe(true);
    expect(flag!.sourceRef).not.toBeNull();
    expect(flag!.sourceRef!.provider).toBe('overlays');
    expect(flag!.sourceRef!.path).toBe('/risks/bushfire');
    // evidence should contain category + guideline
    const ev = JSON.parse(flag!.evidence!);
    expect(ev.category).toBe(1);
    expect(ev.guideline).toBe('Planning for Bushfire Protection 2019');
  });

  it('Category 3 → severity medium', async () => {
    server.use(handleBfplIntrospection(), handleBfplQuery(SINGLE_CAT3_FEATURE));

    const flag = await queryBushfire(-33.8184, 151.2454);

    expect(flag).not.toBeNull();
    expect(flag!.severity).toBe('medium');
    expect(flag!.description).toBe('Vegetation Category 3');
  });

  it('Category 2 → severity low', async () => {
    server.use(handleBfplIntrospection(), handleBfplQuery(SINGLE_CAT2_FEATURE));

    const flag = await queryBushfire(-33.8184, 151.2454);

    expect(flag).not.toBeNull();
    expect(flag!.severity).toBe('low');
    expect(flag!.description).toBe('Vegetation Category 2');
  });

  it('Category 0 (buffer/adjacency) → severity low', async () => {
    server.use(handleBfplIntrospection(), handleBfplQuery(SINGLE_CAT0_FEATURE));

    const flag = await queryBushfire(-33.8184, 151.2454);

    expect(flag).not.toBeNull();
    expect(flag!.severity).toBe('low');
  });
});

describe('queryBushfire — most-severe-wins across multiple features', () => {
  it('Category 3 + Category 1 → returns high (Category 1 wins)', async () => {
    server.use(handleBfplIntrospection(), handleBfplQuery(MULTI_CAT3_AND_CAT1));

    const flag = await queryBushfire(-33.8184, 151.2454);

    expect(flag).not.toBeNull();
    // Category 1 is the highest severity — it should win
    expect(flag!.severity).toBe('high');
    // description should come from the most-severe feature (Category 1)
    expect(flag!.description).toBe('Vegetation Category 1');
  });
});

describe('queryBushfire — empty result', () => {
  it('returns null when no features intersect (not on bushfire-prone land)', async () => {
    server.use(handleBfplIntrospection(), handleBfplQuery(EMPTY_FEATURES));

    const flag = await queryBushfire(-33.8184, 151.2454);

    expect(flag).toBeNull();
  });
});
