// tests/unit/fetchDemographics.test.ts
// Unit tests for Node 12 fetchDemographics.
//
// Covers:
//   - no resolvedAddress → in-band PARTIAL_DATA, demographics undefined
//   - SA2 resolution returns null → { demographics: null }
//   - happy path: sa2 + census fields merged, censusYear=2021, missing fields null
//   - census throwing is swallowed: demographics still carries sa2 fields
//   - resolveSa2 throwing (not returning null) → null demographics (catch → null)

import { fetchDemographics } from '@/agents/nodes/12_fetchDemographics';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphState } from '../fixtures/comps';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockResolveSa2, mockFetchCensusDemographics } = vi.hoisted(() => ({
  mockResolveSa2: vi.fn<() => Promise<{ sa2Code: string; sa2Name: string } | null>>(),
  mockFetchCensusDemographics: vi.fn<() => Promise<Record<string, unknown>>>(),
}));

vi.mock('@/tools/abs/sa2', () => ({ resolveSa2: mockResolveSa2 }));
vi.mock('@/tools/abs/census', () => ({ fetchCensusDemographics: mockFetchCensusDemographics }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOSMAN_SA2 = { sa2Code: '121041688', sa2Name: 'Mosman' };

const CENSUS_FULL = {
  population: 11_234,
  medianAge: 42,
  medianHouseholdIncomeWeekly: 2_800,
  medianPersonalIncomeWeekly: 1_500,
  medianRentWeekly: 650,
  medianMortgageMonthly: 3_200,
  avgHouseholdSize: 2.4,
  ownerOccupiedPct: 72.1,
  rentedPct: 22.3,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockResolveSa2.mockReset();
  mockFetchCensusDemographics.mockReset();
  // Default happy path
  mockResolveSa2.mockResolvedValue(MOSMAN_SA2);
  mockFetchCensusDemographics.mockResolvedValue(CENSUS_FULL);
});

// ---------------------------------------------------------------------------
// PARTIAL_DATA: no resolvedAddress
// ---------------------------------------------------------------------------

describe('fetchDemographics — no resolvedAddress', () => {
  it('returns PARTIAL_DATA error and no demographics', async () => {
    const result = await fetchDemographics(graphState({ resolvedAddress: null }));
    expect(result.errors).toEqual([
      { code: 'PARTIAL_DATA', message: 'fetchDemographics: no resolvedAddress' },
    ]);
    expect(result.demographics).toBeUndefined();
    expect(mockResolveSa2).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SA2 resolution returns null → graceful null demographics
// ---------------------------------------------------------------------------

describe('fetchDemographics — SA2 resolution returns null', () => {
  it('returns { demographics: null } without calling census', async () => {
    mockResolveSa2.mockResolvedValue(null);

    const result = await fetchDemographics(graphState());
    expect(result.errors).toBeUndefined();
    expect(result.demographics).toBeNull();
    expect(mockFetchCensusDemographics).not.toHaveBeenCalled();
  });

  it('catches a thrown resolveSa2 error and returns { demographics: null }', async () => {
    mockResolveSa2.mockRejectedValue(new Error('ArcGIS 503'));

    const result = await fetchDemographics(graphState());
    expect(result.errors).toBeUndefined();
    expect(result.demographics).toBeNull();
    expect(mockFetchCensusDemographics).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy path: sa2 + census fields merged with censusYear and nulls for missing
// ---------------------------------------------------------------------------

describe('fetchDemographics — happy path', () => {
  it('merges sa2 fields + census data with censusYear=2021', async () => {
    const result = await fetchDemographics(graphState());
    expect(result.errors).toBeUndefined();

    const d = result.demographics;
    expect(d).not.toBeNull();
    expect(d?.sa2Code).toBe('121041688');
    expect(d?.sa2Name).toBe('Mosman');
    expect(d?.censusYear).toBe(2021);
    expect(d?.population).toBe(11_234);
    expect(d?.medianAge).toBe(42);
    expect(d?.medianHouseholdIncomeWeekly).toBe(2_800);
    expect(d?.medianPersonalIncomeWeekly).toBe(1_500);
    expect(d?.medianRentWeekly).toBe(650);
    expect(d?.medianMortgageMonthly).toBe(3_200);
    expect(d?.avgHouseholdSize).toBe(2.4);
    expect(d?.ownerOccupiedPct).toBe(72.1);
    expect(d?.rentedPct).toBe(22.3);
  });

  it('missing census fields stay null in the output', async () => {
    // Only population returned from census — everything else absent
    mockFetchCensusDemographics.mockResolvedValue({ population: 5_000 });

    const result = await fetchDemographics(graphState());
    const d = result.demographics;
    expect(d?.population).toBe(5_000);
    expect(d?.medianAge).toBeNull();
    expect(d?.medianHouseholdIncomeWeekly).toBeNull();
    expect(d?.medianPersonalIncomeWeekly).toBeNull();
    expect(d?.medianRentWeekly).toBeNull();
    expect(d?.medianMortgageMonthly).toBeNull();
    expect(d?.avgHouseholdSize).toBeNull();
    expect(d?.ownerOccupiedPct).toBeNull();
    expect(d?.rentedPct).toBeNull();
  });

  it('calls resolveSa2 with the correct lat/lng from resolvedAddress', async () => {
    await fetchDemographics(graphState());
    // sampleResolvedAddress: lat=-33.82, lng=151.24
    expect(mockResolveSa2).toHaveBeenCalledWith(-33.82, 151.24);
  });

  it('calls fetchCensusDemographics with the sa2Code', async () => {
    await fetchDemographics(graphState());
    expect(mockFetchCensusDemographics).toHaveBeenCalledWith('121041688');
  });
});

// ---------------------------------------------------------------------------
// Census throwing is swallowed: demographics still carries sa2 fields
// ---------------------------------------------------------------------------

describe('fetchDemographics — census throws', () => {
  it('swallows the census error and returns demographics with sa2 fields + all nulls', async () => {
    mockFetchCensusDemographics.mockRejectedValue(new Error('Census API down'));

    const result = await fetchDemographics(graphState());
    expect(result.errors).toBeUndefined();

    const d = result.demographics;
    expect(d).not.toBeNull();
    expect(d?.sa2Code).toBe('121041688');
    expect(d?.sa2Name).toBe('Mosman');
    expect(d?.censusYear).toBe(2021);
    // All census fields null since census call failed
    expect(d?.population).toBeNull();
    expect(d?.medianAge).toBeNull();
    expect(d?.medianHouseholdIncomeWeekly).toBeNull();
  });
});
