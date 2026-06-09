// tests/unit/nsw-risk-heritage.test.ts
// MSW 2.6 tests for the heritage risk adapter.
// Covers: SHR hit→high, LEP Local→medium, SHR-outranks-LEP when both hit,
// neither→null. Parallel queries mocked independently.

import { clearLayerIdCache } from '@/tools/nsw-risk/arcgis';
import { queryHeritage } from '@/tools/nsw-risk/heritage';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const BASE = 'http://arcgis-test.local/arcgis/rest/services';

// SHR polygon layer is id 6 (hardcoded in heritage.ts because id 5 and 6 share
// the same name 'State Heritage Register' — the arcgis client's find() would
// return id 5 (points) which never intersects a queried point).
const SHR_SERVICE = 'HMS/Heritage';
const SHR_POLYGON_LAYER_ID = 6;

// LEP/local heritage layer
const EPI_SERVICE = 'Planning/EPI_Primary_Planning_Layers';
const EPI_LAYER_ID = 0;

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
// Fixtures — sampled from live layers (spec §1)
// ---------------------------------------------------------------------------

/** SHR MapServer introspection — two layers share the same name */
const SHR_MAPSERVER = {
  layers: [
    { id: 5, name: 'State Heritage Register', type: 'Feature Layer' },
    { id: 6, name: 'State Heritage Register', type: 'Feature Layer' },
  ],
};

/** EPI MapServer introspection */
const EPI_MAPSERVER = {
  layers: [{ id: 0, name: 'Heritage', type: 'Feature Layer' }],
};

/** SHR positive hit — Sydney Opera House polygon */
const SHR_HIT = {
  features: [
    {
      attributes: {
        ITEMNAME: 'Sydney Opera House',
        ADDRESS: 'Bennelong Point, Sydney',
        LGA: 'CITY OF SYDNEY',
        LISTING: 'State Heritage Register',
        LISTINGNO: '01685',
        TYPE: 'Built',
      },
    },
  ],
};

/** SHR empty — not on SHR */
const SHR_EMPTY = { features: [] };

/** EPI LEP Heritage hit — Local significance */
const EPI_HIT_LOCAL = {
  features: [
    {
      attributes: {
        H_NAME: 'Edgecliff Substation',
        SIG: 'Local',
        LAY_CLASS: 'Heritage Item',
        H_ID: 'I123',
        EPI_NAME: 'Woollahra Local Environmental Plan 2014',
        EPI_TYPE: 'LEP',
      },
    },
  ],
};

/** EPI LEP Heritage hit — State significance */
const EPI_HIT_STATE = {
  features: [
    {
      attributes: {
        H_NAME: 'Royal Botanic Gardens',
        SIG: 'State',
        LAY_CLASS: 'Heritage Item',
        H_ID: 'S456',
        EPI_NAME: 'Sydney Local Environmental Plan 2012',
        EPI_TYPE: 'LEP',
      },
    },
  ],
};

/** EPI empty — no local heritage */
const EPI_EMPTY = { features: [] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleShrIntrospection() {
  return http.get(`${BASE}/${SHR_SERVICE}/MapServer`, () => HttpResponse.json(SHR_MAPSERVER));
}

function handleShrQuery(body: object) {
  // The heritage adapter bypasses name resolution for SHR and uses layer id 6 directly.
  return http.get(`${BASE}/${SHR_SERVICE}/MapServer/${SHR_POLYGON_LAYER_ID}/query`, () =>
    HttpResponse.json(body),
  );
}

function handleEpiIntrospection() {
  return http.get(`${BASE}/${EPI_SERVICE}/MapServer`, () => HttpResponse.json(EPI_MAPSERVER));
}

function handleEpiQuery(body: object) {
  return http.get(`${BASE}/${EPI_SERVICE}/MapServer/${EPI_LAYER_ID}/query`, () =>
    HttpResponse.json(body),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('queryHeritage — SHR only', () => {
  it('SHR hit → severity high, correct description and evidence', async () => {
    server.use(
      handleShrIntrospection(),
      handleShrQuery(SHR_HIT),
      handleEpiIntrospection(),
      handleEpiQuery(EPI_EMPTY),
    );

    const flag = await queryHeritage(-33.8568, 151.2153);

    expect(flag).not.toBeNull();
    expect(flag!.category).toBe('heritage');
    expect(flag!.severity).toBe('high');
    expect(flag!.description).toBe('Sydney Opera House (SHR 01685, Built)');
    expect(flag!.dataAvailable).toBe(true);
    expect(flag!.sourceRef).not.toBeNull();
    expect(flag!.sourceRef!.provider).toBe('overlays');
    expect(flag!.sourceRef!.path).toBe('/risks/heritage');
    // evidence contains the SHR fields
    const ev = JSON.parse(flag!.evidence!);
    expect(ev.listing).toBe('State Heritage Register');
    expect(ev.listingNo).toBe('01685');
    expect(ev.type).toBe('Built');
  });
});

describe('queryHeritage — LEP only', () => {
  it('LEP Local significance → severity medium', async () => {
    server.use(
      handleShrIntrospection(),
      handleShrQuery(SHR_EMPTY),
      handleEpiIntrospection(),
      handleEpiQuery(EPI_HIT_LOCAL),
    );

    const flag = await queryHeritage(-33.8568, 151.2153);

    expect(flag).not.toBeNull();
    expect(flag!.category).toBe('heritage');
    expect(flag!.severity).toBe('medium');
    expect(flag!.description).toBe(
      'Edgecliff Substation — Heritage Item (Local), Woollahra Local Environmental Plan 2014',
    );
    expect(flag!.dataAvailable).toBe(true);
    const ev = JSON.parse(flag!.evidence!);
    expect(ev.sig).toBe('Local');
    expect(ev.layClass).toBe('Heritage Item');
    expect(ev.hId).toBe('I123');
  });

  it('LEP State significance → severity high', async () => {
    server.use(
      handleShrIntrospection(),
      handleShrQuery(SHR_EMPTY),
      handleEpiIntrospection(),
      handleEpiQuery(EPI_HIT_STATE),
    );

    const flag = await queryHeritage(-33.8568, 151.2153);

    expect(flag).not.toBeNull();
    expect(flag!.severity).toBe('high');
    expect(flag!.description).toBe(
      'Royal Botanic Gardens — Heritage Item (State), Sydney Local Environmental Plan 2012',
    );
  });
});

describe('queryHeritage — SHR outranks LEP when both hit', () => {
  it('returns SHR-based flag (high) and folds LEP detail into evidence', async () => {
    server.use(
      handleShrIntrospection(),
      handleShrQuery(SHR_HIT),
      handleEpiIntrospection(),
      handleEpiQuery(EPI_HIT_LOCAL),
    );

    const flag = await queryHeritage(-33.8568, 151.2153);

    expect(flag).not.toBeNull();
    expect(flag!.severity).toBe('high');
    // Description should come from SHR
    expect(flag!.description).toBe('Sydney Opera House (SHR 01685, Built)');
    // Evidence should include both SHR fields and LEP detail
    const ev = JSON.parse(flag!.evidence!);
    expect(ev.listingNo).toBe('01685'); // SHR present
    expect(ev.leп).toBeUndefined(); // no misspelled key
    // LEP info is folded in
    expect(ev.lepName).toBe('Woollahra Local Environmental Plan 2014');
  });
});

describe('queryHeritage — neither SHR nor LEP hits', () => {
  it('returns null when no heritage constraints found', async () => {
    server.use(
      handleShrIntrospection(),
      handleShrQuery(SHR_EMPTY),
      handleEpiIntrospection(),
      handleEpiQuery(EPI_EMPTY),
    );

    const flag = await queryHeritage(-33.8568, 151.2153);

    expect(flag).toBeNull();
  });
});
