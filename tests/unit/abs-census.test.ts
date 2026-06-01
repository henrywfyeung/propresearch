// tests/unit/abs-census.test.ts
// MSW 2.6 tests for fetchCensusDemographics.
// Covers: SDMX CSV parsing (MEDAVG mapping); G01 population; G37 tenure %;
// individual sub-call failure → omit fields (no throw); divide-by-zero guard.
//
// Fixture data is from the live-probed Mosman SA2 121041688 (2026-06-01).

import { fetchCensusDemographics } from '@/tools/abs/census';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const SDMX_BASE = 'http://abs-data-test.local/rest';
const ARCGIS_BASE = 'http://abs-census-arcgis-test.local/arcgis/rest/services';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  process.env.ABS_DATA_API_BASE = SDMX_BASE;
  process.env.ABS_CENSUS_ARCGIS_BASE = ARCGIS_BASE;
});

// ---------------------------------------------------------------------------
// Fixtures — real Mosman SA2 121041688 values (live-probed 2026-06-01)
//
// SDMX-CSV column order: DATAFLOW,MEDAVG,REGION,REGION_TYPE,STATE,TIME_PERIOD,OBS_VALUE
// MEDAVG map: 1=medianAge(45), 2=medianPersonalIncomeWeekly(1464),
//             4=medianHouseholdIncomeWeekly(2822), 5=medianMortgageMonthly(3500),
//             6=medianRentWeekly(600), 8=avgHouseholdSize(2.3)
//
// G01: tot_p_p = 13763
// G37: o_or_total=2320, o_mtg_total=1431, r_tot_total=1784, total_total=5710
//      ownerOccupiedPct = (2320+1431)/5710 * 100 = 65.7
//      rentedPct        = 1784/5710 * 100        = 31.2
// ---------------------------------------------------------------------------

const MOSMAN_SA2 = '121041688';

// Real CSV rows from the live endpoint (header + 8 data rows)
const MOSMAN_SDMX_CSV = [
  'DATAFLOW,MEDAVG,REGION,REGION_TYPE,STATE,TIME_PERIOD,OBS_VALUE',
  `ABS:C21_G02_SA2(1.0.0),3,${MOSMAN_SA2},SA2,1,2021,4154`, // code 3 — not in our map, should be ignored
  `ABS:C21_G02_SA2(1.0.0),7,${MOSMAN_SA2},SA2,1,2021,0.9`, // code 7 — not in our map
  `ABS:C21_G02_SA2(1.0.0),4,${MOSMAN_SA2},SA2,1,2021,2822`, // medianHouseholdIncomeWeekly
  `ABS:C21_G02_SA2(1.0.0),1,${MOSMAN_SA2},SA2,1,2021,45`, // medianAge
  `ABS:C21_G02_SA2(1.0.0),2,${MOSMAN_SA2},SA2,1,2021,1464`, // medianPersonalIncomeWeekly
  `ABS:C21_G02_SA2(1.0.0),5,${MOSMAN_SA2},SA2,1,2021,3500`, // medianMortgageMonthly
  `ABS:C21_G02_SA2(1.0.0),6,${MOSMAN_SA2},SA2,1,2021,600`, // medianRentWeekly
  `ABS:C21_G02_SA2(1.0.0),8,${MOSMAN_SA2},SA2,1,2021,2.3`, // avgHouseholdSize
].join('\n');

// ArcGIS FeatureServer returns lowercase attribute keys (confirmed live)
const MOSMAN_G01_RESPONSE = {
  features: [{ attributes: { tot_p_p: 13763 } }],
};

const MOSMAN_G37_RESPONSE = {
  features: [
    {
      attributes: {
        o_or_total: 2320,
        o_mtg_total: 1431,
        r_tot_total: 1784,
        total_total: 5710,
      },
    },
  ],
};

const G37_ZERO_TOTAL_RESPONSE = {
  features: [
    {
      attributes: {
        o_or_total: 0,
        o_mtg_total: 0,
        r_tot_total: 0,
        total_total: 0,
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// MSW handler helpers
// ---------------------------------------------------------------------------

function handleSdmx(sa2Code: string, body: string, status = 200) {
  const urlPattern = new RegExp(
    `${SDMX_BASE}/data/ABS,C21_G02_SA2,1\\.0\\.0/\\.${sa2Code}\\.SA2\\.`,
  );
  return http.get(urlPattern, () =>
    HttpResponse.text(body, {
      status,
      headers: { 'Content-Type': 'application/vnd.sdmx.data+csv' },
    }),
  );
}

function handleG01(sa2Code: string, body: object, status = 200) {
  return http.get(`${ARCGIS_BASE}/ABS_2021_Census_G01_SA2/FeatureServer/0/query`, ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get('where')?.includes(sa2Code)) {
      return HttpResponse.json(body, { status });
    }
    return HttpResponse.json({ features: [] });
  });
}

function handleG37(sa2Code: string, body: object, status = 200) {
  return http.get(`${ARCGIS_BASE}/ABS_2021_Census_G37_SA2/FeatureServer/0/query`, ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get('where')?.includes(sa2Code)) {
      return HttpResponse.json(body, { status });
    }
    return HttpResponse.json({ features: [] });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchCensusDemographics — SDMX CSV parsing', () => {
  it('maps MEDAVG codes to the correct fields for Mosman', async () => {
    server.use(
      handleSdmx(MOSMAN_SA2, MOSMAN_SDMX_CSV),
      handleG01(MOSMAN_SA2, MOSMAN_G01_RESPONSE),
      handleG37(MOSMAN_SA2, MOSMAN_G37_RESPONSE),
    );

    const result = await fetchCensusDemographics(MOSMAN_SA2);

    expect(result.medianAge).toBe(45);
    expect(result.medianPersonalIncomeWeekly).toBe(1464);
    expect(result.medianHouseholdIncomeWeekly).toBe(2822);
    expect(result.medianMortgageMonthly).toBe(3500); // MONTHLY — not weekly
    expect(result.medianRentWeekly).toBe(600); // WEEKLY
    expect(result.avgHouseholdSize).toBe(2.3);
  });

  it('ignores unknown MEDAVG codes without error', async () => {
    // CSV with only unknown codes
    const csvUnknownOnly = [
      'DATAFLOW,MEDAVG,REGION,REGION_TYPE,STATE,TIME_PERIOD,OBS_VALUE',
      `ABS:C21_G02_SA2(1.0.0),99,${MOSMAN_SA2},SA2,1,2021,999`,
    ].join('\n');

    server.use(
      handleSdmx(MOSMAN_SA2, csvUnknownOnly),
      handleG01(MOSMAN_SA2, MOSMAN_G01_RESPONSE),
      handleG37(MOSMAN_SA2, MOSMAN_G37_RESPONSE),
    );

    const result = await fetchCensusDemographics(MOSMAN_SA2);

    // All medians fields should remain null; population/tenure still present
    expect(result.medianAge).toBeNull();
    expect(result.medianHouseholdIncomeWeekly).toBeNull();
    expect(result.population).toBe(13763);
  });
});

describe('fetchCensusDemographics — G01 population', () => {
  it('returns population from tot_p_p (lowercase, as the live service returns)', async () => {
    server.use(
      handleSdmx(MOSMAN_SA2, MOSMAN_SDMX_CSV),
      handleG01(MOSMAN_SA2, MOSMAN_G01_RESPONSE),
      handleG37(MOSMAN_SA2, MOSMAN_G37_RESPONSE),
    );

    const result = await fetchCensusDemographics(MOSMAN_SA2);

    expect(result.population).toBe(13763);
  });
});

describe('fetchCensusDemographics — G37 tenure', () => {
  it('computes ownerOccupiedPct and rentedPct for Mosman', async () => {
    server.use(
      handleSdmx(MOSMAN_SA2, MOSMAN_SDMX_CSV),
      handleG01(MOSMAN_SA2, MOSMAN_G01_RESPONSE),
      handleG37(MOSMAN_SA2, MOSMAN_G37_RESPONSE),
    );

    const result = await fetchCensusDemographics(MOSMAN_SA2);

    // (2320 + 1431) / 5710 * 100 = 65.7%
    expect(result.ownerOccupiedPct).toBe(65.7);
    // 1784 / 5710 * 100 = 31.2%
    expect(result.rentedPct).toBe(31.2);
  });

  it('returns null for tenure fields when total_total is 0 (divide-by-zero guard)', async () => {
    server.use(
      handleSdmx(MOSMAN_SA2, MOSMAN_SDMX_CSV),
      handleG01(MOSMAN_SA2, MOSMAN_G01_RESPONSE),
      handleG37(MOSMAN_SA2, G37_ZERO_TOTAL_RESPONSE),
    );

    const result = await fetchCensusDemographics(MOSMAN_SA2);

    expect(result.ownerOccupiedPct).toBeNull();
    expect(result.rentedPct).toBeNull();
    // Other fields unaffected
    expect(result.population).toBe(13763);
    expect(result.medianAge).toBe(45);
  });
});

describe('fetchCensusDemographics — per-sub-call degradation', () => {
  it('omits tenure fields but returns medians + population when G37 returns 500', async () => {
    server.use(
      handleSdmx(MOSMAN_SA2, MOSMAN_SDMX_CSV),
      handleG01(MOSMAN_SA2, MOSMAN_G01_RESPONSE),
      handleG37(MOSMAN_SA2, { error: 'server error' }, 503),
    );

    // pRetry will exhaust retries then reject; allSettled catches it
    const result = await fetchCensusDemographics(MOSMAN_SA2);

    // tenure omitted
    expect(result.ownerOccupiedPct).toBeUndefined();
    expect(result.rentedPct).toBeUndefined();

    // other sub-calls still present
    expect(result.medianAge).toBe(45);
    expect(result.population).toBe(13763);
  }, 30_000);

  it('omits population but returns medians + tenure when G01 returns 500', async () => {
    server.use(
      handleSdmx(MOSMAN_SA2, MOSMAN_SDMX_CSV),
      handleG01(MOSMAN_SA2, { error: 'server error' }, 503),
      handleG37(MOSMAN_SA2, MOSMAN_G37_RESPONSE),
    );

    const result = await fetchCensusDemographics(MOSMAN_SA2);

    expect(result.population).toBeUndefined();
    expect(result.medianAge).toBe(45);
    expect(result.ownerOccupiedPct).toBe(65.7);
  }, 30_000);

  it('omits medians but returns population + tenure when SDMX returns 500', async () => {
    server.use(
      handleSdmx(MOSMAN_SA2, '', 503),
      handleG01(MOSMAN_SA2, MOSMAN_G01_RESPONSE),
      handleG37(MOSMAN_SA2, MOSMAN_G37_RESPONSE),
    );

    const result = await fetchCensusDemographics(MOSMAN_SA2);

    expect(result.medianAge).toBeUndefined();
    expect(result.medianHouseholdIncomeWeekly).toBeUndefined();
    expect(result.population).toBe(13763);
    expect(result.ownerOccupiedPct).toBe(65.7);
  }, 30_000);

  it('does not throw when all three sub-calls fail', async () => {
    server.use(
      handleSdmx(MOSMAN_SA2, '', 503),
      handleG01(MOSMAN_SA2, { error: 'server error' }, 503),
      handleG37(MOSMAN_SA2, { error: 'server error' }, 503),
    );

    await expect(fetchCensusDemographics(MOSMAN_SA2)).resolves.toEqual({});
  }, 30_000);
});

describe('fetchCensusDemographics — happy path returns all fields', () => {
  it('returns a complete Partial<SuburbDemographics> when all calls succeed', async () => {
    server.use(
      handleSdmx(MOSMAN_SA2, MOSMAN_SDMX_CSV),
      handleG01(MOSMAN_SA2, MOSMAN_G01_RESPONSE),
      handleG37(MOSMAN_SA2, MOSMAN_G37_RESPONSE),
    );

    const result = await fetchCensusDemographics(MOSMAN_SA2);

    // Medians
    expect(result.medianAge).toBe(45);
    expect(result.medianHouseholdIncomeWeekly).toBe(2822);
    expect(result.medianPersonalIncomeWeekly).toBe(1464);
    expect(result.medianMortgageMonthly).toBe(3500);
    expect(result.medianRentWeekly).toBe(600);
    expect(result.avgHouseholdSize).toBe(2.3);
    // Population
    expect(result.population).toBe(13763);
    // Tenure
    expect(result.ownerOccupiedPct).toBe(65.7);
    expect(result.rentedPct).toBe(31.2);
  });
});
