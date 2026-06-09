// tests/unit/nsw-risk-flood.test.ts
// MSW 2.6 tests for the flood risk adapter.
//
// queryFlood ALWAYS returns a RiskFlag (never null). The three branches:
//   1. hit  → dataAvailable:true, severity from LAY_CLASS
//   2. empty + lga ∈ COVERED_FLOOD_LGAS → dataAvailable:true, severity:'informational'
//   3. empty + (lga ∉ covered OR lga===null) → dataAvailable:false, severity:'informational'
//
// Layer: ePlanning/Planning_Portal_Hazard/MapServer/230 "Flood Planning Map"
// Fixtures use real sampled values from live layer (probed 2026-06-01).

import { clearLayerIdCache } from '@/tools/nsw-risk/arcgis';
import { queryFlood } from '@/tools/nsw-risk/flood';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const BASE = 'http://arcgis-test.local/arcgis/rest/services';
const SERVICE = 'ePlanning/Planning_Portal_Hazard';
const LAYER_ID = 230;

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
// Fixtures — sampled from live layer (Clarence Valley, probed 2026-06-01)
// ---------------------------------------------------------------------------

const FLOOD_MAPSERVER = {
  layers: [
    { id: 228, name: 'Hazard', type: 'Feature Layer' },
    { id: 229, name: 'Bushfire Prone Land', type: 'Feature Layer' },
    { id: 230, name: 'Flood Planning Map', type: 'Feature Layer' },
    {
      id: 231,
      name: 'Hunter Valley Flood Mitigation Scheme Development Consent Area',
      type: 'Feature Layer',
    },
    { id: 232, name: 'Landslide Risk Land', type: 'Feature Layer' },
  ],
};

/** Real live response from Grafton area in Clarence Valley — two overlapping flood zones */
const HIT_FLOOD_PLANNING_AREA = {
  features: [
    {
      attributes: {
        EPI_NAME: 'Clarence Valley Local Environmental Plan 2011',
        LGA_NAME: 'CLARENCE VALLEY',
        LAY_CLASS: 'Flood Planning Area',
        EPI_TYPE: 'LEP',
      },
    },
  ],
};

/** Probable Maximum Flood Line — should map to 'high' */
const HIT_PROBABLE_MAXIMUM = {
  features: [
    {
      attributes: {
        EPI_NAME: 'Clarence Valley Local Environmental Plan 2011',
        LGA_NAME: 'CLARENCE VALLEY',
        LAY_CLASS: 'Probable Maximum Flood Line',
        EPI_TYPE: 'LEP',
      },
    },
  ],
};

/** Level of Probable Maximum Flood — also 'high' */
const HIT_LEVEL_PMF = {
  features: [
    {
      attributes: {
        EPI_NAME: 'Some LEP 2020',
        LGA_NAME: 'HORNSBY',
        LAY_CLASS: 'Level of Probable Maximum Flood',
        EPI_TYPE: 'LEP',
      },
    },
  ],
};

/** 1 in 100 AEP — should map to 'high' */
const HIT_1_IN_100 = {
  features: [
    {
      attributes: {
        EPI_NAME: 'Some LEP',
        LGA_NAME: 'WOLLONGONG',
        LAY_CLASS: '1 in 100 AEP Flood Extent',
        EPI_TYPE: 'LEP',
      },
    },
  ],
};

/** Flood Prone and Major Creeks Land — 'high' */
const HIT_FLOOD_PRONE = {
  features: [
    {
      attributes: {
        EPI_NAME: 'Forbes LEP',
        LGA_NAME: 'FORBES',
        LAY_CLASS: 'Flood Prone and Major Creeks Land',
        EPI_TYPE: 'LEP',
      },
    },
  ],
};

/** Transitional Land — 'low' */
const HIT_TRANSITIONAL = {
  features: [
    {
      attributes: {
        EPI_NAME: 'Some LEP',
        LGA_NAME: 'WINGECARRIBEE',
        LAY_CLASS: 'Transitional Land',
        EPI_TYPE: 'LEP',
      },
    },
  ],
};

/** Unknown LAY_CLASS — 'medium' (else branch) */
const HIT_UNKNOWN_CLASS = {
  features: [
    {
      attributes: {
        EPI_NAME: 'Some LEP',
        LGA_NAME: 'BATHURST REGIONAL',
        LAY_CLASS: 'Area 1',
        EPI_TYPE: 'LEP',
      },
    },
  ],
};

/** Multiple features — most severe (PMF + Flood Planning Area) → PMF wins → 'high' */
const HIT_MULTIPLE = {
  features: [
    {
      attributes: {
        EPI_NAME: 'Clarence Valley Local Environmental Plan 2011',
        LGA_NAME: 'CLARENCE VALLEY',
        LAY_CLASS: 'Flood Planning Area',
        EPI_TYPE: 'LEP',
      },
    },
    {
      attributes: {
        EPI_NAME: 'Clarence Valley Local Environmental Plan 2011',
        LGA_NAME: 'CLARENCE VALLEY',
        LAY_CLASS: 'Probable Maximum Flood Line',
        EPI_TYPE: 'LEP',
      },
    },
  ],
};

const EMPTY_FEATURES = { features: [] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleIntrospection() {
  return http.get(`${BASE}/${SERVICE}/MapServer`, () => HttpResponse.json(FLOOD_MAPSERVER));
}

function handleFloodQuery(body: object) {
  return http.get(`${BASE}/${SERVICE}/MapServer/${LAYER_ID}/query`, () => HttpResponse.json(body));
}

// ---------------------------------------------------------------------------
// Tests: hit branch (LAY_CLASS → severity)
// ---------------------------------------------------------------------------

describe('queryFlood — hit: severity from LAY_CLASS', () => {
  it('Flood Planning Area → severity high, dataAvailable:true', async () => {
    server.use(handleIntrospection(), handleFloodQuery(HIT_FLOOD_PLANNING_AREA));

    const flag = await queryFlood(-29.685, 152.94, 'CLARENCE VALLEY');

    expect(flag.category).toBe('flood');
    expect(flag.severity).toBe('high');
    expect(flag.dataAvailable).toBe(true);
    expect(flag.description).toBe('Flood Planning Area');
    expect(flag.sourceRef).not.toBeNull();
    expect(flag.sourceRef!.provider).toBe('overlays');
    expect(flag.sourceRef!.path).toBe('/risks/flood');
    const ev = JSON.parse(flag.evidence!);
    expect(ev.layClass).toBe('Flood Planning Area');
    expect(ev.epi).toBe('Clarence Valley Local Environmental Plan 2011');
  });

  it('Probable Maximum Flood Line → severity high', async () => {
    server.use(handleIntrospection(), handleFloodQuery(HIT_PROBABLE_MAXIMUM));

    const flag = await queryFlood(-29.685, 152.94, 'CLARENCE VALLEY');

    expect(flag.severity).toBe('high');
    expect(flag.description).toBe('Probable Maximum Flood Line');
  });

  it('Level of Probable Maximum Flood → severity high', async () => {
    server.use(handleIntrospection(), handleFloodQuery(HIT_LEVEL_PMF));

    const flag = await queryFlood(-33.702, 151.095, 'HORNSBY');

    expect(flag.severity).toBe('high');
  });

  it('1 in 100 AEP Flood Extent → severity high', async () => {
    server.use(handleIntrospection(), handleFloodQuery(HIT_1_IN_100));

    const flag = await queryFlood(-34.424, 150.893, 'WOLLONGONG');

    expect(flag.severity).toBe('high');
  });

  it('Flood Prone and Major Creeks Land → severity high', async () => {
    server.use(handleIntrospection(), handleFloodQuery(HIT_FLOOD_PRONE));

    const flag = await queryFlood(-33.393, 148.015, 'FORBES');

    expect(flag.severity).toBe('high');
  });

  it('Transitional Land → severity low', async () => {
    server.use(handleIntrospection(), handleFloodQuery(HIT_TRANSITIONAL));

    const flag = await queryFlood(-34.485, 150.43, 'WINGECARRIBEE');

    expect(flag.severity).toBe('low');
    expect(flag.description).toBe('Transitional Land');
  });

  it('unknown LAY_CLASS (Area 1) → severity medium', async () => {
    server.use(handleIntrospection(), handleFloodQuery(HIT_UNKNOWN_CLASS));

    const flag = await queryFlood(-33.42, 149.58, 'BATHURST REGIONAL');

    expect(flag.severity).toBe('medium');
  });

  it('multiple features — most severe wins (PMF + FPA → PMF takes priority)', async () => {
    server.use(handleIntrospection(), handleFloodQuery(HIT_MULTIPLE));

    const flag = await queryFlood(-29.685, 152.94, 'CLARENCE VALLEY');

    // PMF-derived severity (high) should win regardless of order
    expect(flag.severity).toBe('high');
    expect(flag.dataAvailable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: empty + covered LGA → dataAvailable:true, informational
// ---------------------------------------------------------------------------

describe('queryFlood — empty + covered LGA → informational, dataAvailable:true', () => {
  it('Wollongong (covered, empty result) → informational + dataAvailable:true', async () => {
    server.use(handleIntrospection(), handleFloodQuery(EMPTY_FEATURES));

    const flag = await queryFlood(-34.424, 150.893, 'WOLLONGONG');

    expect(flag.category).toBe('flood');
    expect(flag.severity).toBe('informational');
    expect(flag.dataAvailable).toBe(true);
    expect(flag.description).toMatch(/no flood-planning constraint/i);
    expect(flag.sourceRef).not.toBeNull();
  });

  it('Hornsby (covered, empty) → informational + dataAvailable:true', async () => {
    server.use(handleIntrospection(), handleFloodQuery(EMPTY_FEATURES));

    const flag = await queryFlood(-33.702, 151.095, 'HORNSBY');

    expect(flag.severity).toBe('informational');
    expect(flag.dataAvailable).toBe(true);
  });

  it('Tamworth Regional (covered) → informational + dataAvailable:true', async () => {
    server.use(handleIntrospection(), handleFloodQuery(EMPTY_FEATURES));

    const flag = await queryFlood(-31.093, 150.932, 'TAMWORTH REGIONAL');

    expect(flag.severity).toBe('informational');
    expect(flag.dataAvailable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: empty + uncovered/null LGA → dataAvailable:false
// The CRITICAL safety test — must never return a false "no flood risk"
// ---------------------------------------------------------------------------

describe('queryFlood — empty + uncovered or null LGA → dataAvailable:false', () => {
  it('Mosman (not covered) → dataAvailable:false', async () => {
    server.use(handleIntrospection(), handleFloodQuery(EMPTY_FEATURES));

    const flag = await queryFlood(-33.8308, 151.2428, 'MOSMAN');

    expect(flag.category).toBe('flood');
    expect(flag.severity).toBe('informational');
    expect(flag.dataAvailable).toBe(false);
    expect(flag.description).toMatch(/NSW has not published/i);
    expect(flag.sourceRef).toBeNull();
    expect(flag.evidence).toBeNull();
  });

  it('null LGA (unresolved) → dataAvailable:false', async () => {
    server.use(handleIntrospection(), handleFloodQuery(EMPTY_FEATURES));

    const flag = await queryFlood(-33.8308, 151.2428, null);

    expect(flag.dataAvailable).toBe(false);
    expect(flag.severity).toBe('informational');
    expect(flag.sourceRef).toBeNull();
  });

  it('unknown string LGA → dataAvailable:false', async () => {
    server.use(handleIntrospection(), handleFloodQuery(EMPTY_FEATURES));

    const flag = await queryFlood(-37.8136, 144.9631, 'MELBOURNE');

    expect(flag.dataAvailable).toBe(false);
  });

  // Safety invariant: NEVER a false "no risk" for uncovered LGA
  it('SAFETY: never returns dataAvailable:true with uncovered LGA', async () => {
    server.use(handleIntrospection(), handleFloodQuery(EMPTY_FEATURES));

    for (const lga of [null, 'HAWKESBURY', 'BLACKTOWN', 'SYDNEY']) {
      const flag = await queryFlood(-33.77, 150.92, lga);
      expect(
        flag.dataAvailable,
        `LGA "${lga}" should not get dataAvailable:true on empty flood result`,
      ).toBe(false);
      server.resetHandlers();
      clearLayerIdCache();
      server.use(handleIntrospection(), handleFloodQuery(EMPTY_FEATURES));
    }
  });

  it('SAFETY: a hit always returns dataAvailable:true regardless of LGA coverage', async () => {
    // Even an uncovered LGA should show dataAvailable:true when there IS a hit
    server.use(handleIntrospection(), handleFloodQuery(HIT_FLOOD_PLANNING_AREA));

    const flag = await queryFlood(-33.77, 150.92, 'MOSMAN');

    expect(flag.dataAvailable).toBe(true);
    expect(flag.severity).not.toBe('informational');
  });
});
