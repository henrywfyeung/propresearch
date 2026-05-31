// tests/unit/fetchPlanning.test.ts
// Unit tests for Node 05 fetchPlanning.
//
// Covers (per task spec):
//   - maps records → RecentDA with correct haversine distance + description synthesis
//   - ≤500m filter drops far records
//   - skips records with missing/NaN coords
//   - sorts by distance asc + caps at 25
//   - NSW-gate: non-NSW → empty market, no adapter calls
//   - council-unresolved (lgaToCouncil→null) → empty market
//   - fetch throws → empty market (no graph error)
//   - PARTIAL_DATA when no resolvedAddress

import { fetchPlanning } from '@/agents/nodes/05_planningAndNews';
import type { OnlineDaRecord } from '@/tools/nsw-planning/onlineDa';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphState } from '../fixtures/comps';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockFetchRecentDAs, mockLgaToCouncil, mockResolveLga } = vi.hoisted(() => ({
  mockFetchRecentDAs: vi.fn<() => Promise<OnlineDaRecord[]>>(),
  mockLgaToCouncil: vi.fn<(lga: string) => string | null>(),
  mockResolveLga: vi.fn<() => Promise<string | null>>(),
}));

vi.mock('@/tools/nsw-planning/onlineDa', () => ({ fetchRecentDAs: mockFetchRecentDAs }));
vi.mock('@/tools/nsw-planning/councils', () => ({ lgaToCouncil: mockLgaToCouncil }));
vi.mock('@/tools/nsw-risk/lga', () => ({ resolveLga: mockResolveLga }));

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

// Subject property: Mosman (lat, lng used for haversine)
const NSW_ADDRESS = {
  lat: -33.82,
  lng: 151.24,
  suburb: 'Mosman',
  postcode: '2088',
  state: 'NSW' as const,
  normalizedAddress: '1 Example St, Mosman NSW 2088',
};

const VIC_ADDRESS = {
  lat: -37.81,
  lng: 144.96,
  suburb: 'Melbourne',
  postcode: '3000',
  state: 'VIC' as const,
  normalizedAddress: '1 Example St, Melbourne VIC 3000',
};

// ---------------------------------------------------------------------------
// DA record fixtures
//
// The subject is at (-33.82, 151.24).
// Nearby record: (-33.822, 151.242) → haversine ≈ 275m (within 500m)
// Far record:    (-33.90,  151.30)  → haversine ≈ 10 km  (outside 500m)
// ---------------------------------------------------------------------------

function makeRecord(opts: {
  lat: string;
  lng: string;
  devTypes?: string[];
  appType?: string;
  category?: string;
  status?: string;
  lodgedDate?: string;
}): OnlineDaRecord {
  return {
    ApplicationStatus: opts.status ?? 'Determined',
    LodgementDate: opts.lodgedDate ?? '2026-01-15',
    ApplicationType: opts.appType ?? 'Development Application',
    DevelopmentCategory: opts.category,
    DevelopmentType: opts.devTypes?.map((t) => ({ DevelopmentType: t })),
    Location: [{ X: opts.lng, Y: opts.lat }],
  };
}

const NEARBY_RECORD = makeRecord({
  lat: '-33.822',
  lng: '151.242',
  devTypes: ['Dwelling house', 'Alterations or additions'],
  category: 'Residential',
  status: 'Under Assessment',
  lodgedDate: '2026-03-10',
});

const FAR_RECORD = makeRecord({
  lat: '-33.90',
  lng: '151.30',
  devTypes: ['Commercial premises'],
  category: 'Commercial',
  lodgedDate: '2026-02-01',
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockFetchRecentDAs.mockReset();
  mockLgaToCouncil.mockReset();
  mockResolveLga.mockReset();
  // Default happy path
  mockResolveLga.mockResolvedValue('MOSMAN');
  mockLgaToCouncil.mockImplementation((lga) =>
    lga === 'MOSMAN' ? 'Mosman Municipal Council' : null,
  );
});

// ---------------------------------------------------------------------------
// PARTIAL_DATA: no resolvedAddress
// ---------------------------------------------------------------------------

describe('fetchPlanning — no resolvedAddress', () => {
  it('returns PARTIAL_DATA error and no market', async () => {
    const state = graphState({ resolvedAddress: null });
    const result = await fetchPlanning(state);
    expect(result.errors).toEqual([
      { code: 'PARTIAL_DATA', message: 'fetchPlanning: no resolvedAddress' },
    ]);
    expect(result.market).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// NSW gate: non-NSW address
// ---------------------------------------------------------------------------

describe('fetchPlanning — non-NSW address (NSW gate)', () => {
  it('returns empty market without calling any adapters', async () => {
    const state = graphState({ resolvedAddress: VIC_ADDRESS });
    const result = await fetchPlanning(state);

    expect(result.errors).toBeUndefined();
    expect(result.market).toEqual({ suburbStats: null, recentNews: [], recentDAs: [] });

    expect(mockResolveLga).not.toHaveBeenCalled();
    expect(mockLgaToCouncil).not.toHaveBeenCalled();
    expect(mockFetchRecentDAs).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Council-unresolved: lgaToCouncil returns null
// ---------------------------------------------------------------------------

describe('fetchPlanning — unmapped LGA (lgaToCouncil returns null)', () => {
  it('returns empty market without calling fetchRecentDAs', async () => {
    mockResolveLga.mockResolvedValue('SOMEUNKNOWNLGA');
    mockLgaToCouncil.mockReturnValue(null);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchPlanning(state);

    expect(result.errors).toBeUndefined();
    expect(result.market).toEqual({ suburbStats: null, recentNews: [], recentDAs: [] });
    expect(mockFetchRecentDAs).not.toHaveBeenCalled();
  });

  it('degrades gracefully when resolveLga returns null (no LGA info)', async () => {
    mockResolveLga.mockResolvedValue(null);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchPlanning(state);

    expect(result.errors).toBeUndefined();
    expect(result.market).toEqual({ suburbStats: null, recentNews: [], recentDAs: [] });
    expect(mockFetchRecentDAs).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// fetchRecentDAs throws: graceful degrade
// ---------------------------------------------------------------------------

describe('fetchPlanning — fetchRecentDAs throws', () => {
  it('returns empty market with no graph error', async () => {
    mockFetchRecentDAs.mockRejectedValue(new Error('API 503'));

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchPlanning(state);

    expect(result.errors).toBeUndefined();
    expect(result.market).toEqual({ suburbStats: null, recentNews: [], recentDAs: [] });
  });
});

// ---------------------------------------------------------------------------
// Happy path: record mapping, distance filter, description synthesis
// ---------------------------------------------------------------------------

describe('fetchPlanning — happy path', () => {
  it('maps nearby record → RecentDA with correct fields', async () => {
    mockFetchRecentDAs.mockResolvedValue([NEARBY_RECORD]);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchPlanning(state);

    expect(result.errors).toBeUndefined();
    expect(result.market?.recentDAs).toHaveLength(1);

    const da = result.market!.recentDAs[0]!;
    // Description synthesized from DevelopmentType array
    expect(da.description).toBe('Dwelling house; Alterations or additions');
    expect(da.status).toBe('Under Assessment');
    expect(da.category).toBe('Residential');
    expect(da.lodgedDate).toBe('2026-03-10');
    expect(da.coverage).toBe('full');
    // distanceM should be > 0 and within 500m
    expect(da.distanceM).toBeGreaterThan(0);
    expect(da.distanceM).toBeLessThanOrEqual(500);
    // sourceRef
    expect(da.sourceRef.provider).toBe('nsw-planning');
    expect(da.sourceRef.path).toBe('/market/recentDAs');
    expect(da.sourceRef.endpoint).toContain('OnlineDA');
  });

  it('falls back to ApplicationType when DevelopmentType is absent', async () => {
    const record = makeRecord({
      lat: '-33.822',
      lng: '151.242',
      appType: 'Development Application',
      // no devTypes
    });
    mockFetchRecentDAs.mockResolvedValue([record]);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchPlanning(state);

    expect(result.market?.recentDAs[0]?.description).toBe('Development Application');
  });

  it('uses ApplicationType as category fallback when DevelopmentCategory is absent', async () => {
    const record = makeRecord({
      lat: '-33.822',
      lng: '151.242',
      appType: 'Modification Application',
      // no category
    });
    mockFetchRecentDAs.mockResolvedValue([record]);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchPlanning(state);

    expect(result.market?.recentDAs[0]?.category).toBe('Modification Application');
  });
});

// ---------------------------------------------------------------------------
// Distance filter: ≤500m kept, >500m dropped
// ---------------------------------------------------------------------------

describe('fetchPlanning — distance filter (≤500m)', () => {
  it('drops records further than 500m', async () => {
    mockFetchRecentDAs.mockResolvedValue([NEARBY_RECORD, FAR_RECORD]);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchPlanning(state);

    expect(result.market?.recentDAs).toHaveLength(1);
    expect(result.market?.recentDAs[0]?.description).toBe(
      'Dwelling house; Alterations or additions',
    );
  });

  it('returns empty recentDAs when all records are out of range', async () => {
    mockFetchRecentDAs.mockResolvedValue([FAR_RECORD]);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchPlanning(state);

    expect(result.market?.recentDAs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Skips records with missing / non-finite coords
// ---------------------------------------------------------------------------

describe('fetchPlanning — missing / invalid coords', () => {
  it('skips records with empty Location array', async () => {
    const badRecord: OnlineDaRecord = {
      ApplicationStatus: 'Lodged',
      LodgementDate: '2026-01-01',
      ApplicationType: 'DA',
      Location: [],
    };
    mockFetchRecentDAs.mockResolvedValue([badRecord, NEARBY_RECORD]);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchPlanning(state);

    expect(result.market?.recentDAs).toHaveLength(1);
  });

  it('skips records with non-numeric X/Y strings', async () => {
    const badRecord: OnlineDaRecord = {
      ApplicationStatus: 'Lodged',
      LodgementDate: '2026-01-01',
      ApplicationType: 'DA',
      Location: [{ X: 'N/A', Y: 'N/A' }],
    };
    mockFetchRecentDAs.mockResolvedValue([badRecord, NEARBY_RECORD]);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchPlanning(state);

    expect(result.market?.recentDAs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Sort by distance asc + cap at 25
// ---------------------------------------------------------------------------

describe('fetchPlanning — sort + cap', () => {
  it('sorts by distanceM ascending', async () => {
    // Two nearby records: one closer (~14m), one further (~280m) — both within 500m
    const closer = makeRecord({ lat: '-33.8201', lng: '151.2401' }); // ~14m
    const further = makeRecord({ lat: '-33.8225', lng: '151.2425' }); // ~280m
    mockFetchRecentDAs.mockResolvedValue([further, closer]); // intentionally reversed

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchPlanning(state);

    const dists = result.market!.recentDAs.map((d) => d.distanceM);
    expect(dists[0]).toBeLessThan(dists[1]!);
  });

  it('caps at 25 records', async () => {
    // Generate 30 records all within ~10-50m of subject
    const records: OnlineDaRecord[] = Array.from({ length: 30 }, (_, i) =>
      makeRecord({
        lat: String(-33.82 + i * 0.0001), // tiny offsets, all within 500m
        lng: '151.24',
      }),
    );
    mockFetchRecentDAs.mockResolvedValue(records);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchPlanning(state);

    expect(result.market?.recentDAs).toHaveLength(25);
  });
});

// ---------------------------------------------------------------------------
// resolveLga throws: graceful degrade
// ---------------------------------------------------------------------------

describe('fetchPlanning — resolveLga throws', () => {
  it('returns empty market without crashing the node', async () => {
    mockResolveLga.mockRejectedValue(new Error('LGA service 503'));

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchPlanning(state);

    expect(result.errors).toBeUndefined();
    expect(result.market).toEqual({ suburbStats: null, recentNews: [], recentDAs: [] });
    expect(mockFetchRecentDAs).not.toHaveBeenCalled();
  });
});
