// src/tools/abs/census.ts
// Fetches ABS Census 2021 demographics for a given SA2 code.
//
// Three parallel calls (Promise.allSettled — each failure omits its fields):
//   1. SDMX-CSV medians  (data.api.abs.gov.au)  → age, income, rent, mortgage, household size
//   2. ArcGIS G01        (services-ap1.arcgis.com) → population
//   3. ArcGIS G37        (services-ap1.arcgis.com) → owner-occupied %, rented %
//
// Gotchas (spec §1 + live-probe findings):
//   - SDMX host is data.api.abs.gov.au/rest/ (the old api.data.abs.gov.au 301-redirects)
//   - Request CSV with Accept: application/vnd.sdmx.data+csv (avoids JSON positional decoding)
//   - rent = WEEKLY, mortgage = MONTHLY
//   - ArcGIS FeatureServer attributes come back LOWERCASE (confirmed live: tot_p_p, o_or_total…)

import { logger } from '@/lib/observability/logger';
import type { SuburbDemographics } from '@/schemas/state';
import pRetry, { AbortError } from 'p-retry';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Base URLs (overridable via env for tests)
// ---------------------------------------------------------------------------

function sdmxBase(): string {
  return process.env.ABS_DATA_API_BASE ?? 'https://data.api.abs.gov.au/rest';
}

function censusArcgisBase(): string {
  return (
    process.env.ABS_CENSUS_ARCGIS_BASE ??
    'https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services'
  );
}

// ---------------------------------------------------------------------------
// Retryable statuses
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchText(url: string, headers?: Record<string, string>): Promise<string> {
  return pRetry(
    async () => {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        if (RETRYABLE_STATUS.has(res.status)) {
          throw new Error(`ABS fetch HTTP ${res.status}: ${url}`);
        }
        throw new AbortError(`ABS fetch non-retryable HTTP ${res.status}: ${url}`);
      }
      return res.text();
    },
    {
      retries: 3,
      minTimeout: 500,
      maxTimeout: 8_000,
      factor: 2,
      onFailedAttempt: (e) =>
        logger.warn(
          { url, attempt: e.attemptNumber, retriesLeft: e.retriesLeft },
          'abs fetch retry',
        ),
    },
  );
}

async function fetchJson(url: string): Promise<unknown> {
  return pRetry(
    async () => {
      const res = await fetch(url);
      if (!res.ok) {
        if (RETRYABLE_STATUS.has(res.status)) {
          throw new Error(`ABS ArcGIS HTTP ${res.status}: ${url}`);
        }
        throw new AbortError(`ABS ArcGIS non-retryable HTTP ${res.status}: ${url}`);
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
          'abs arcgis retry',
        ),
    },
  );
}

// ---------------------------------------------------------------------------
// MEDAVG code → field mapping (spec §1)
// 1=medianAge, 2=medianPersonalIncomeWeekly, 4=medianHouseholdIncomeWeekly,
// 5=medianMortgageMonthly (MONTHLY), 6=medianRentWeekly, 8=avgHouseholdSize
// ---------------------------------------------------------------------------

type MediansResult = Pick<
  SuburbDemographics,
  | 'medianAge'
  | 'medianPersonalIncomeWeekly'
  | 'medianHouseholdIncomeWeekly'
  | 'medianMortgageMonthly'
  | 'medianRentWeekly'
  | 'avgHouseholdSize'
>;

const MEDAVG_MAP: Record<string, keyof MediansResult> = {
  '1': 'medianAge',
  '2': 'medianPersonalIncomeWeekly',
  '4': 'medianHouseholdIncomeWeekly',
  '5': 'medianMortgageMonthly',
  '6': 'medianRentWeekly',
  '8': 'avgHouseholdSize',
};

function parseSdmxCsv(text: string): MediansResult {
  const lines = text.trim().split('\n');
  // First line is the header.
  const header = lines[0]?.split(',') ?? [];
  const medavgIdx = header.indexOf('MEDAVG');
  const obsIdx = header.indexOf('OBS_VALUE');

  const result: MediansResult = {
    medianAge: null,
    medianPersonalIncomeWeekly: null,
    medianHouseholdIncomeWeekly: null,
    medianMortgageMonthly: null,
    medianRentWeekly: null,
    avgHouseholdSize: null,
  };

  if (medavgIdx === -1 || obsIdx === -1) return result;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]?.split(',') ?? [];
    const medavgCode = cols[medavgIdx]?.trim();
    const obsRaw = cols[obsIdx]?.trim();
    if (!medavgCode || !obsRaw) continue;

    const field = MEDAVG_MAP[medavgCode];
    if (!field) continue;

    const value = Number(obsRaw);
    if (Number.isFinite(value)) {
      result[field] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// ArcGIS G01 — population
// Attributes come back lowercase from this FeatureServer (confirmed live).
// ---------------------------------------------------------------------------

const G01AttributesSchema = z.object({
  // Accept either case; the live service returns lowercase.
  tot_p_p: z.number().optional(),
  Tot_P_P: z.number().optional(),
});

const G01ResponseSchema = z.object({
  features: z.array(z.object({ attributes: G01AttributesSchema })),
});

type PopulationResult = Pick<SuburbDemographics, 'population'>;

async function fetchPopulation(sa2Code: string): Promise<PopulationResult> {
  const base = censusArcgisBase();
  const url = new URL(`${base}/ABS_2021_Census_G01_SA2/FeatureServer/0/query`);
  url.searchParams.set('where', `SA2_CODE_2021='${sa2Code}'`);
  url.searchParams.set('outFields', 'Tot_P_P');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');

  const raw = await fetchJson(url.toString());
  const parsed = G01ResponseSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ sa2Code, issues: parsed.error.issues }, 'abs G01 schema mismatch');
    return { population: null };
  }

  const attrs = parsed.data.features[0]?.attributes;
  if (!attrs) return { population: null };

  // Handle both lowercase (live) and titlecase (potential future change).
  const value = attrs.tot_p_p ?? attrs.Tot_P_P ?? null;
  return { population: value ?? null };
}

// ---------------------------------------------------------------------------
// ArcGIS G37 — tenure
// Attributes come back lowercase from this FeatureServer (confirmed live).
// ---------------------------------------------------------------------------

const G37AttributesSchema = z.object({
  o_or_total: z.number().optional(),
  O_OR_Total: z.number().optional(),
  o_mtg_total: z.number().optional(),
  O_MTG_Total: z.number().optional(),
  r_tot_total: z.number().optional(),
  R_Tot_Total: z.number().optional(),
  total_total: z.number().optional(),
  Total_Total: z.number().optional(),
});

const G37ResponseSchema = z.object({
  features: z.array(z.object({ attributes: G37AttributesSchema })),
});

type TenureResult = Pick<SuburbDemographics, 'ownerOccupiedPct' | 'rentedPct'>;

async function fetchTenure(sa2Code: string): Promise<TenureResult> {
  const base = censusArcgisBase();
  const url = new URL(`${base}/ABS_2021_Census_G37_SA2/FeatureServer/0/query`);
  url.searchParams.set('where', `SA2_CODE_2021='${sa2Code}'`);
  url.searchParams.set('outFields', 'O_OR_Total,O_MTG_Total,R_Tot_Total,Total_Total');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');

  const raw = await fetchJson(url.toString());
  const parsed = G37ResponseSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ sa2Code, issues: parsed.error.issues }, 'abs G37 schema mismatch');
    return { ownerOccupiedPct: null, rentedPct: null };
  }

  const attrs = parsed.data.features[0]?.attributes;
  if (!attrs) return { ownerOccupiedPct: null, rentedPct: null };

  // Handle both lowercase (live) and titlecase (potential future change).
  const ownedOutright = attrs.o_or_total ?? attrs.O_OR_Total ?? 0;
  const ownedMortgage = attrs.o_mtg_total ?? attrs.O_MTG_Total ?? 0;
  const rented = attrs.r_tot_total ?? attrs.R_Tot_Total ?? 0;
  const total = attrs.total_total ?? attrs.Total_Total ?? 0;

  if (total === 0) {
    // Guard divide-by-zero.
    return { ownerOccupiedPct: null, rentedPct: null };
  }

  return {
    ownerOccupiedPct: Math.round(((ownedOutright + ownedMortgage) / total) * 1000) / 10,
    rentedPct: Math.round((rented / total) * 1000) / 10,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch Census 2021 demographics for a given SA2 code.
 *
 * Runs three requests in parallel. Each can fail independently — a failure
 * omits that sub-set of fields but never throws. Returns a Partial containing
 * only the fields that were successfully fetched.
 */
export async function fetchCensusDemographics(
  sa2Code: string,
): Promise<Partial<SuburbDemographics>> {
  const sdmxUrl = `${sdmxBase()}/data/ABS,C21_G02_SA2,1.0.0/.${sa2Code}.SA2.?dimensionAtObservation=AllDimensions`;

  const [mediansResult, populationResult, tenureResult] = await Promise.allSettled([
    // 1. SDMX-CSV medians
    fetchText(sdmxUrl, { Accept: 'application/vnd.sdmx.data+csv' }).then(parseSdmxCsv),
    // 2. ArcGIS G01 — population
    fetchPopulation(sa2Code),
    // 3. ArcGIS G37 — tenure
    fetchTenure(sa2Code),
  ]);

  const merged: Partial<SuburbDemographics> = {};

  if (mediansResult.status === 'fulfilled') {
    Object.assign(merged, mediansResult.value);
  } else {
    logger.warn({ sa2Code, err: mediansResult.reason }, 'abs census medians call failed');
  }

  if (populationResult.status === 'fulfilled') {
    Object.assign(merged, populationResult.value);
  } else {
    logger.warn({ sa2Code, err: populationResult.reason }, 'abs census G01 call failed');
  }

  if (tenureResult.status === 'fulfilled') {
    Object.assign(merged, tenureResult.value);
  } else {
    logger.warn({ sa2Code, err: tenureResult.reason }, 'abs census G37 call failed');
  }

  return merged;
}
