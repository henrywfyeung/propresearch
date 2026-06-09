// tests/unit/vic-risk-adapters.test.ts
// MSW 2.6 tests for the three VIC risk adapters: flood, bushfire, heritage.
//
// All three adapters call vicWfsPointQuery which GET-s the Vicmap WFS base URL.
// We use a single MSW server at the VIC_VICMAP_WFS base and discriminate
// requests by the `typeNames` query parameter.
//
// Fixtures are based on the live Vicmap samples described in spec §5 / §2:
//   Maribyrnong LSIO → flood medium
//   FO               → flood high
//   Dandenong BMO    → bushfire high
//   BPA-only         → bushfire medium
//   Fitzroy HO       → heritage medium
//   Royal Exhibition VHR → heritage high
//   VHR + HO both    → VHR outranks HO (high wins)

import { queryVicBushfire } from '@/tools/vic-risk/bushfire';
import { queryVicFlood } from '@/tools/vic-risk/flood';
import { queryVicHeritage } from '@/tools/vic-risk/heritage';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
// Response fixtures
// ---------------------------------------------------------------------------

// ---- Flood ----------------------------------------------------------------

/** Maribyrnong LSIO — flood medium */
const FLOOD_LSIO = {
  features: [
    {
      properties: {
        scheme_code: 'LSIO',
        zone_code: 'LSIO',
        zone_description: 'Land Subject to Inundation Overlay',
        lga: 'MARIBYRNONG',
        gaz_begin_date: '2014-06-19',
      },
    },
  ],
};

/** Floodway Overlay (FO) — flood high */
const FLOOD_FO = {
  features: [
    {
      properties: {
        scheme_code: 'FO',
        zone_code: 'FO',
        zone_description: 'Floodway Overlay',
        lga: 'YARRA',
        gaz_begin_date: '2013-09-12',
      },
    },
  ],
};

/** Special Building Overlay (SBO) — flood medium */
const FLOOD_SBO = {
  features: [
    {
      properties: {
        scheme_code: 'SBO',
        zone_code: 'SBO',
        zone_description: 'Special Building Overlay',
        lga: 'MELBOURNE',
        gaz_begin_date: '2012-01-01',
      },
    },
  ],
};

/** FO + LSIO — FO is higher severity */
const FLOOD_FO_AND_LSIO = {
  features: [
    {
      properties: {
        scheme_code: 'LSIO',
        zone_code: 'LSIO',
        zone_description: 'Land Subject to Inundation Overlay',
        lga: 'YARRA',
        gaz_begin_date: '2013-09-12',
      },
    },
    {
      properties: {
        scheme_code: 'FO',
        zone_code: 'FO',
        zone_description: 'Floodway Overlay',
        lga: 'YARRA',
        gaz_begin_date: '2013-09-12',
      },
    },
  ],
};

// ---- Bushfire -------------------------------------------------------------

/** Dandenong BMO — bushfire high */
const BUSHFIRE_BMO = {
  features: [
    {
      properties: {
        scheme_code: 'BMO',
        zone_code: 'BMO',
        zone_description: 'Bushfire Management Overlay',
        lga: 'KNOX',
        gaz_begin_date: '2011-11-24',
      },
    },
  ],
};

/** BPA only (no BMO) — bushfire medium */
const BUSHFIRE_BPA = {
  features: [
    {
      properties: {
        lga_name: 'NILLUMBIK',
        plan_number: 'S2',
        gazettal_date: '2014-07-08',
      },
    },
  ],
};

// ---- Heritage -------------------------------------------------------------

/** Fitzroy HO — heritage medium */
const HERITAGE_HO = {
  features: [
    {
      properties: {
        scheme_code: 'HO',
        zone_code: 'HO3',
        zone_description: 'Heritage Overlay - Fitzroy',
        lga: 'YARRA',
      },
    },
  ],
};

/** Royal Exhibition Building VHR — heritage high */
const HERITAGE_VHR = {
  features: [
    {
      properties: {
        vhr_num: 'H0022',
        site_name: 'Royal Exhibition Building and Carlton Gardens',
        // The live WFS returns hermes_num as a NUMBER — use the real shape here
        // so this test guards against the string-only schema regression.
        hermes_num: 7680,
      },
    },
  ],
};

/** Empty — no features */
const EMPTY = { features: [] };

// ---------------------------------------------------------------------------
// Helpers: intercept WFS by typeNames query param
// ---------------------------------------------------------------------------

/**
 * Handle a GET to WFS_BASE, match by typeNames param value, respond with body.
 */
function handleWfs(typeNames: string, body: object) {
  return http.get(WFS_BASE, ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get('typeNames') === typeNames) {
      return HttpResponse.json(body);
    }
    // Pass to next handler
    return undefined;
  });
}

// ---------------------------------------------------------------------------
// queryVicFlood tests
// ---------------------------------------------------------------------------

describe('queryVicFlood — LSIO → medium', () => {
  it('LSIO overlay → severity medium, correct description and evidence', async () => {
    server.use(handleWfs('open-data-platform:plan_overlay', FLOOD_LSIO));

    const flag = await queryVicFlood(-37.7965, 144.9125);

    expect(flag).not.toBeNull();
    expect(flag!.category).toBe('flood');
    expect(flag!.severity).toBe('medium');
    expect(flag!.description).toBe('Land Subject to Inundation Overlay');
    expect(flag!.dataAvailable).toBe(true);
    expect(flag!.sourceRef).not.toBeNull();
    expect(flag!.sourceRef!.provider).toBe('overlays');
    expect(flag!.sourceRef!.path).toBe('/risks/flood');

    const ev = JSON.parse(flag!.evidence!);
    expect(ev.scheme_code).toBe('LSIO');
    expect(ev.lga).toBe('MARIBYRNONG');
    expect(ev.gaz_begin_date).toBe('2014-06-19');
  });
});

describe('queryVicFlood — FO → high', () => {
  it('FO overlay → severity high', async () => {
    server.use(handleWfs('open-data-platform:plan_overlay', FLOOD_FO));

    const flag = await queryVicFlood(-37.8, 145.0);

    expect(flag).not.toBeNull();
    expect(flag!.severity).toBe('high');
    expect(flag!.description).toBe('Floodway Overlay');
    const ev = JSON.parse(flag!.evidence!);
    expect(ev.scheme_code).toBe('FO');
  });
});

describe('queryVicFlood — SBO → medium', () => {
  it('SBO overlay → severity medium', async () => {
    server.use(handleWfs('open-data-platform:plan_overlay', FLOOD_SBO));

    const flag = await queryVicFlood(-37.81, 144.96);

    expect(flag).not.toBeNull();
    expect(flag!.severity).toBe('medium');
    const ev = JSON.parse(flag!.evidence!);
    expect(ev.scheme_code).toBe('SBO');
  });
});

describe('queryVicFlood — FO + LSIO → FO wins (high)', () => {
  it('most-severe-wins: FO outranks LSIO', async () => {
    server.use(handleWfs('open-data-platform:plan_overlay', FLOOD_FO_AND_LSIO));

    const flag = await queryVicFlood(-37.8, 145.0);

    expect(flag).not.toBeNull();
    expect(flag!.severity).toBe('high');
    const ev = JSON.parse(flag!.evidence!);
    expect(ev.scheme_code).toBe('FO');
  });
});

describe('queryVicFlood — empty result → null', () => {
  it('no flood overlays → returns null', async () => {
    server.use(handleWfs('open-data-platform:plan_overlay', EMPTY));

    const flag = await queryVicFlood(-37.81, 144.96);

    expect(flag).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// queryVicBushfire tests
// ---------------------------------------------------------------------------

describe('queryVicBushfire — BMO → high', () => {
  it('BMO hit → severity high, description from zone_description', async () => {
    server.use(
      handleWfs('open-data-platform:plan_overlay', BUSHFIRE_BMO),
      handleWfs('open-data-platform:bushfire_prone_area', EMPTY),
    );

    const flag = await queryVicBushfire(-37.87, 145.23);

    expect(flag).not.toBeNull();
    expect(flag!.category).toBe('bushfire');
    expect(flag!.severity).toBe('high');
    expect(flag!.description).toBe('Bushfire Management Overlay');
    expect(flag!.dataAvailable).toBe(true);
    expect(flag!.sourceRef!.path).toBe('/risks/bushfire');

    const ev = JSON.parse(flag!.evidence!);
    expect(ev.bmo).toBeDefined();
    expect(ev.bmo.zone_description).toBe('Bushfire Management Overlay');
    expect(ev.bpa).toBeUndefined(); // BPA not hit
  });
});

describe('queryVicBushfire — BPA only → medium', () => {
  it('no BMO, BPA hit → severity medium', async () => {
    server.use(
      handleWfs('open-data-platform:plan_overlay', EMPTY),
      handleWfs('open-data-platform:bushfire_prone_area', BUSHFIRE_BPA),
    );

    const flag = await queryVicBushfire(-37.67, 145.12);

    expect(flag).not.toBeNull();
    expect(flag!.severity).toBe('medium');
    expect(flag!.description).toBe('Bushfire Prone Area (BPA)');

    const ev = JSON.parse(flag!.evidence!);
    expect(ev.bpa).toBeDefined();
    expect(ev.bpa.plan_number).toBe('S2');
    expect(ev.bmo).toBeUndefined(); // BMO not hit
  });
});

describe('queryVicBushfire — BMO + BPA → BMO wins (high), evidence merges both', () => {
  it('both BMO and BPA hit → severity high, both in evidence', async () => {
    server.use(
      handleWfs('open-data-platform:plan_overlay', BUSHFIRE_BMO),
      handleWfs('open-data-platform:bushfire_prone_area', BUSHFIRE_BPA),
    );

    const flag = await queryVicBushfire(-37.87, 145.23);

    expect(flag).not.toBeNull();
    expect(flag!.severity).toBe('high');

    const ev = JSON.parse(flag!.evidence!);
    expect(ev.bmo).toBeDefined();
    expect(ev.bpa).toBeDefined();
    expect(ev.bpa.plan_number).toBe('S2');
  });
});

describe('queryVicBushfire — neither hit → null', () => {
  it('no BMO, no BPA → returns null', async () => {
    server.use(
      handleWfs('open-data-platform:plan_overlay', EMPTY),
      handleWfs('open-data-platform:bushfire_prone_area', EMPTY),
    );

    const flag = await queryVicBushfire(-37.81, 144.96);

    expect(flag).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// queryVicHeritage tests
// ---------------------------------------------------------------------------

describe('queryVicHeritage — HO only → medium', () => {
  it('HO overlay → severity medium, description from zone_description', async () => {
    server.use(
      handleWfs('open-data-platform:plan_overlay', HERITAGE_HO),
      handleWfs('open-data-platform:heritage_register', EMPTY),
    );

    const flag = await queryVicHeritage(-37.79, 144.98);

    expect(flag).not.toBeNull();
    expect(flag!.category).toBe('heritage');
    expect(flag!.severity).toBe('medium');
    expect(flag!.description).toBe('Heritage Overlay - Fitzroy');
    expect(flag!.dataAvailable).toBe(true);
    expect(flag!.sourceRef!.path).toBe('/risks/heritage');

    const ev = JSON.parse(flag!.evidence!);
    expect(ev.ho).toBeDefined();
    expect(ev.ho.zone_code).toBe('HO3');
  });
});

describe('queryVicHeritage — VHR → high', () => {
  it('VHR hit → severity high, description from site_name', async () => {
    server.use(
      handleWfs('open-data-platform:plan_overlay', EMPTY),
      handleWfs('open-data-platform:heritage_register', HERITAGE_VHR),
    );

    const flag = await queryVicHeritage(-37.804, 144.972);

    expect(flag).not.toBeNull();
    expect(flag!.category).toBe('heritage');
    expect(flag!.severity).toBe('high');
    expect(flag!.description).toBe('Royal Exhibition Building and Carlton Gardens');

    const ev = JSON.parse(flag!.evidence!);
    expect(ev.vhr).toBeDefined();
    expect(ev.vhr.vhr_num).toBe('H0022');
    expect(ev.vhr.hermes_num).toBe(7680);
    expect(ev.ho).toBeUndefined(); // HO not hit
  });
});

describe('queryVicHeritage — VHR outranks HO when both hit', () => {
  it('both VHR and HO hit → returns VHR flag (high), HO folded into evidence', async () => {
    server.use(
      handleWfs('open-data-platform:plan_overlay', HERITAGE_HO),
      handleWfs('open-data-platform:heritage_register', HERITAGE_VHR),
    );

    const flag = await queryVicHeritage(-37.804, 144.972);

    expect(flag).not.toBeNull();
    expect(flag!.severity).toBe('high');
    // Description comes from VHR site_name
    expect(flag!.description).toBe('Royal Exhibition Building and Carlton Gardens');

    // Evidence includes both VHR and HO
    const ev = JSON.parse(flag!.evidence!);
    expect(ev.vhr).toBeDefined();
    expect(ev.vhr.vhr_num).toBe('H0022');
    expect(ev.ho).toBeDefined();
    expect(ev.ho.zone_code).toBe('HO3');
  });
});

describe('queryVicHeritage — neither VHR nor HO → null', () => {
  it('no heritage constraints found → returns null', async () => {
    server.use(
      handleWfs('open-data-platform:plan_overlay', EMPTY),
      handleWfs('open-data-platform:heritage_register', EMPTY),
    );

    const flag = await queryVicHeritage(-37.81, 144.96);

    expect(flag).toBeNull();
  });
});
