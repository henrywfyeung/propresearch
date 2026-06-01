// tests/unit/fetchRisks.test.ts
// Unit tests for Node 09 fetchRisks and the annotation `risks` reducer.
//
// Covers (per task spec):
//   - NSW path: merges all 3 categories from the adapters
//   - NSW path: bushfire/heritage null → 'None identified.' informational flag
//   - NSW path: rejected adapter → dataAvailable:false degrade flag
//   - VIC path: calls VIC adapters; merges 3 categories
//   - VIC path: null → 'None identified.'; rejected → degrade flag
//   - WA/other → 3 dataAvailable:false flags with updated message
//   - PARTIAL_DATA error when no resolvedAddress
//   - annotation `risks` reducer merges by category (mirrors state-helpers.test.ts)

import { fetchRisks } from '@/agents/nodes/09_fetchRisks';
import { mergeByKey } from '@/agents/state';
import type { RiskFlag } from '@/schemas/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphState } from '../fixtures/comps';

// ---------------------------------------------------------------------------
// Mocks — hoisted so vi.mock factory can reference them
// ---------------------------------------------------------------------------

const {
  mockQueryBushfire,
  mockQueryHeritage,
  mockQueryFlood,
  mockResolveLga,
  mockQueryVicBushfire,
  mockQueryVicHeritage,
  mockQueryVicFlood,
} = vi.hoisted(() => ({
  mockQueryBushfire: vi.fn<() => Promise<RiskFlag | null>>(),
  mockQueryHeritage: vi.fn<() => Promise<RiskFlag | null>>(),
  mockQueryFlood: vi.fn<() => Promise<RiskFlag>>(),
  mockResolveLga: vi.fn<() => Promise<string | null>>(),
  mockQueryVicBushfire: vi.fn<() => Promise<RiskFlag | null>>(),
  mockQueryVicHeritage: vi.fn<() => Promise<RiskFlag | null>>(),
  mockQueryVicFlood: vi.fn<() => Promise<RiskFlag | null>>(),
}));

vi.mock('@/tools/nsw-risk/bushfire', () => ({ queryBushfire: mockQueryBushfire }));
vi.mock('@/tools/nsw-risk/heritage', () => ({ queryHeritage: mockQueryHeritage }));
vi.mock('@/tools/nsw-risk/flood', () => ({ queryFlood: mockQueryFlood }));
vi.mock('@/tools/nsw-risk/lga', () => ({ resolveLga: mockResolveLga }));
vi.mock('@/tools/vic-risk/bushfire', () => ({ queryVicBushfire: mockQueryVicBushfire }));
vi.mock('@/tools/vic-risk/heritage', () => ({ queryVicHeritage: mockQueryVicHeritage }));
vi.mock('@/tools/vic-risk/flood', () => ({ queryVicFlood: mockQueryVicFlood }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

// WA is used to test the "unsupported state" path
const WA_ADDRESS = {
  lat: -31.95,
  lng: 115.86,
  suburb: 'Perth',
  postcode: '6000',
  state: 'WA' as const,
  normalizedAddress: '1 Example St, Perth WA 6000',
};

const bushfireFlag: RiskFlag = {
  category: 'bushfire',
  severity: 'high',
  description: 'Vegetation Category 1',
  dataAvailable: true,
  sourceRef: {
    provider: 'overlays',
    endpoint: 'http://example/bushfire/query',
    fetchedAt: '2026-06-01T00:00:00.000Z',
    path: '/risks/bushfire',
  },
  evidence: JSON.stringify({ category: 1, guideline: 'Planning for Bushfire Protection 2019' }),
};

const heritageFlag: RiskFlag = {
  category: 'heritage',
  severity: 'high',
  description: 'Some heritage item (SHR 1234, Heritage Place)',
  dataAvailable: true,
  sourceRef: {
    provider: 'overlays',
    endpoint: 'http://example/heritage/query',
    fetchedAt: '2026-06-01T00:00:00.000Z',
    path: '/risks/heritage',
  },
  evidence: JSON.stringify({ listingNo: '1234', type: 'Heritage Place' }),
};

const floodFlag: RiskFlag = {
  category: 'flood',
  severity: 'high',
  description: '1 in 100 AEP Flood Extent',
  dataAvailable: true,
  sourceRef: {
    provider: 'overlays',
    endpoint: 'http://example/flood/query',
    fetchedAt: '2026-06-01T00:00:00.000Z',
    path: '/risks/flood',
  },
  evidence: JSON.stringify({ layClass: '1 in 100 AEP Flood Extent', epi: 'Test LEP' }),
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQueryBushfire.mockReset();
  mockQueryHeritage.mockReset();
  mockQueryFlood.mockReset();
  mockResolveLga.mockReset();
  mockResolveLga.mockResolvedValue('MOSMAN');
  mockQueryVicBushfire.mockReset();
  mockQueryVicHeritage.mockReset();
  mockQueryVicFlood.mockReset();
});

// ---------------------------------------------------------------------------
// Test: PARTIAL_DATA when no resolvedAddress
// ---------------------------------------------------------------------------

describe('fetchRisks — no resolvedAddress', () => {
  it('returns PARTIAL_DATA error and no risks', async () => {
    const state = graphState({ resolvedAddress: null });
    const result = await fetchRisks(state);
    expect(result.errors).toEqual([
      { code: 'PARTIAL_DATA', message: 'fetchRisks: no resolvedAddress' },
    ]);
    expect(result.risks).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test: unsupported state (WA — neither NSW nor VIC)
// ---------------------------------------------------------------------------

describe('fetchRisks — unsupported state (WA)', () => {
  it('returns 3 dataAvailable:false informational flags without calling any adapters', async () => {
    const state = graphState({ resolvedAddress: WA_ADDRESS });
    const result = await fetchRisks(state);

    expect(result.errors).toBeUndefined();
    expect(result.risks).toHaveLength(3);

    const categories = result.risks!.map((r) => r.category).sort();
    expect(categories).toEqual(['bushfire', 'flood', 'heritage']);

    for (const flag of result.risks!) {
      expect(flag.dataAvailable).toBe(false);
      expect(flag.severity).toBe('informational');
      expect(flag.description).toBe('Risk data sources cover NSW and VIC in v1.');
    }

    // No adapters called
    expect(mockQueryBushfire).not.toHaveBeenCalled();
    expect(mockQueryVicBushfire).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test: VIC branch — happy path + degrade
// ---------------------------------------------------------------------------

const vicBushfireFlag: RiskFlag = {
  category: 'bushfire',
  severity: 'high',
  description: 'Bushfire Management Overlay',
  dataAvailable: true,
  sourceRef: {
    provider: 'overlays',
    endpoint: 'http://example/wfs',
    fetchedAt: '2026-06-01T00:00:00.000Z',
    path: '/risks/bushfire',
  },
  evidence: JSON.stringify({ bmo: { zone_description: 'Bushfire Management Overlay' } }),
};

const vicHeritageFlag: RiskFlag = {
  category: 'heritage',
  severity: 'high',
  description: 'Royal Exhibition Building',
  dataAvailable: true,
  sourceRef: {
    provider: 'overlays',
    endpoint: 'http://example/wfs',
    fetchedAt: '2026-06-01T00:00:00.000Z',
    path: '/risks/heritage',
  },
  evidence: JSON.stringify({ vhr: { vhr_num: 'H0022' } }),
};

const vicFloodFlag: RiskFlag = {
  category: 'flood',
  severity: 'medium',
  description: 'Land Subject to Inundation Overlay',
  dataAvailable: true,
  sourceRef: {
    provider: 'overlays',
    endpoint: 'http://example/wfs',
    fetchedAt: '2026-06-01T00:00:00.000Z',
    path: '/risks/flood',
  },
  evidence: JSON.stringify({ scheme_code: 'LSIO' }),
};

describe('fetchRisks — VIC, all adapters return flags', () => {
  it('calls VIC adapters (not NSW) and merges all 3 categories', async () => {
    mockQueryVicBushfire.mockResolvedValue(vicBushfireFlag);
    mockQueryVicHeritage.mockResolvedValue(vicHeritageFlag);
    mockQueryVicFlood.mockResolvedValue(vicFloodFlag);

    const state = graphState({ resolvedAddress: VIC_ADDRESS });
    const result = await fetchRisks(state);

    expect(result.errors).toBeUndefined();
    expect(result.risks).toHaveLength(3);

    // VIC adapters called with the VIC coordinates
    expect(mockQueryVicBushfire).toHaveBeenCalledWith(VIC_ADDRESS.lat, VIC_ADDRESS.lng);
    expect(mockQueryVicHeritage).toHaveBeenCalledWith(VIC_ADDRESS.lat, VIC_ADDRESS.lng);
    expect(mockQueryVicFlood).toHaveBeenCalledWith(VIC_ADDRESS.lat, VIC_ADDRESS.lng);

    // NSW adapters NOT called
    expect(mockQueryBushfire).not.toHaveBeenCalled();
    expect(mockQueryHeritage).not.toHaveBeenCalled();
    expect(mockQueryFlood).not.toHaveBeenCalled();
    // No LGA resolution for VIC (statewide WFS)
    expect(mockResolveLga).not.toHaveBeenCalled();

    const byCategory = Object.fromEntries(result.risks!.map((r) => [r.category, r]));
    expect(byCategory.bushfire).toMatchObject({ severity: 'high', dataAvailable: true });
    expect(byCategory.heritage).toMatchObject({ severity: 'high', dataAvailable: true });
    expect(byCategory.flood).toMatchObject({ severity: 'medium', dataAvailable: true });
  });
});

describe('fetchRisks — VIC, null from adapters → noneFlag', () => {
  it('bushfire null → "None identified." informational', async () => {
    mockQueryVicBushfire.mockResolvedValue(null);
    mockQueryVicHeritage.mockResolvedValue(vicHeritageFlag);
    mockQueryVicFlood.mockResolvedValue(vicFloodFlag);

    const state = graphState({ resolvedAddress: VIC_ADDRESS });
    const result = await fetchRisks(state);

    const bfFlag = result.risks!.find((r) => r.category === 'bushfire')!;
    expect(bfFlag.dataAvailable).toBe(true);
    expect(bfFlag.severity).toBe('informational');
    expect(bfFlag.description).toBe('None identified.');
  });

  it('flood null → "None identified." informational (VIC flood is not always-non-null)', async () => {
    mockQueryVicBushfire.mockResolvedValue(null);
    mockQueryVicHeritage.mockResolvedValue(null);
    mockQueryVicFlood.mockResolvedValue(null);

    const state = graphState({ resolvedAddress: VIC_ADDRESS });
    const result = await fetchRisks(state);

    for (const flag of result.risks!) {
      expect(flag.severity).toBe('informational');
      expect(flag.description).toBe('None identified.');
      expect(flag.dataAvailable).toBe(true);
    }
  });
});

describe('fetchRisks — VIC, adapter throws → degrade flag', () => {
  it('bushfire throws → degrade; others still returned', async () => {
    mockQueryVicBushfire.mockRejectedValue(new Error('WFS 503'));
    mockQueryVicHeritage.mockResolvedValue(vicHeritageFlag);
    mockQueryVicFlood.mockResolvedValue(vicFloodFlag);

    const state = graphState({ resolvedAddress: VIC_ADDRESS });
    const result = await fetchRisks(state);

    expect(result.errors).toBeUndefined();
    const bfFlag = result.risks!.find((r) => r.category === 'bushfire')!;
    expect(bfFlag.dataAvailable).toBe(false);
    expect(bfFlag.description).toBe('Risk data unavailable (source error).');

    const htFlag = result.risks!.find((r) => r.category === 'heritage')!;
    expect(htFlag.dataAvailable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test: happy path — all adapters return positive flags
// ---------------------------------------------------------------------------

describe('fetchRisks — NSW, all adapters return flags', () => {
  it('merges all 3 categories from the adapters', async () => {
    mockQueryBushfire.mockResolvedValue(bushfireFlag);
    mockQueryHeritage.mockResolvedValue(heritageFlag);
    mockQueryFlood.mockResolvedValue(floodFlag);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchRisks(state);

    expect(result.errors).toBeUndefined();
    expect(result.risks).toHaveLength(3);

    const byCategory = Object.fromEntries(result.risks!.map((r) => [r.category, r]));

    expect(byCategory.bushfire).toMatchObject({ severity: 'high', dataAvailable: true });
    expect(byCategory.heritage).toMatchObject({ severity: 'high', dataAvailable: true });
    expect(byCategory.flood).toMatchObject({ severity: 'high', dataAvailable: true });
  });

  it('passes LGA to queryFlood', async () => {
    mockResolveLga.mockResolvedValue('HORNSBY');
    mockQueryBushfire.mockResolvedValue(null);
    mockQueryHeritage.mockResolvedValue(null);
    mockQueryFlood.mockResolvedValue(floodFlag);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    await fetchRisks(state);

    expect(mockQueryFlood).toHaveBeenCalledWith(NSW_ADDRESS.lat, NSW_ADDRESS.lng, 'HORNSBY');
  });
});

// ---------------------------------------------------------------------------
// Test: null from bushfire/heritage → 'None identified.' informational flag
// ---------------------------------------------------------------------------

describe('fetchRisks — null adapter results (no intersect)', () => {
  it('bushfire null → dataAvailable:true "None identified." informational flag', async () => {
    mockQueryBushfire.mockResolvedValue(null);
    mockQueryHeritage.mockResolvedValue(heritageFlag);
    mockQueryFlood.mockResolvedValue(floodFlag);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchRisks(state);

    const bfFlag = result.risks!.find((r) => r.category === 'bushfire')!;
    expect(bfFlag.dataAvailable).toBe(true);
    expect(bfFlag.severity).toBe('informational');
    expect(bfFlag.description).toBe('None identified.');
  });

  it('heritage null → dataAvailable:true "None identified." informational flag', async () => {
    mockQueryBushfire.mockResolvedValue(bushfireFlag);
    mockQueryHeritage.mockResolvedValue(null);
    mockQueryFlood.mockResolvedValue(floodFlag);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchRisks(state);

    const htFlag = result.risks!.find((r) => r.category === 'heritage')!;
    expect(htFlag.dataAvailable).toBe(true);
    expect(htFlag.severity).toBe('informational');
    expect(htFlag.description).toBe('None identified.');
  });

  it('both bushfire and heritage null → both get "None identified." flags', async () => {
    mockQueryBushfire.mockResolvedValue(null);
    mockQueryHeritage.mockResolvedValue(null);
    mockQueryFlood.mockResolvedValue(floodFlag);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchRisks(state);

    expect(result.risks).toHaveLength(3);
    const noneFlags = result.risks!.filter((r) => r.description === 'None identified.');
    expect(noneFlags).toHaveLength(2);
    expect(noneFlags.map((f) => f.category).sort()).toEqual(['bushfire', 'heritage']);
  });
});

// ---------------------------------------------------------------------------
// Test: rejected adapter → degrade flag; other categories still present
// ---------------------------------------------------------------------------

describe('fetchRisks — adapter failures (graceful degrade)', () => {
  it('bushfire throws → dataAvailable:false degrade flag; other 2 categories still returned', async () => {
    mockQueryBushfire.mockRejectedValue(new Error('ArcGIS 503'));
    mockQueryHeritage.mockResolvedValue(heritageFlag);
    mockQueryFlood.mockResolvedValue(floodFlag);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchRisks(state);

    expect(result.errors).toBeUndefined(); // node does not propagate error to graph
    expect(result.risks).toHaveLength(3);

    const bfFlag = result.risks!.find((r) => r.category === 'bushfire')!;
    expect(bfFlag.dataAvailable).toBe(false);
    expect(bfFlag.severity).toBe('informational');
    expect(bfFlag.description).toBe('Risk data unavailable (source error).');
    expect(bfFlag.sourceRef).toBeNull();

    // Other categories still present and correct
    const htFlag = result.risks!.find((r) => r.category === 'heritage')!;
    expect(htFlag.dataAvailable).toBe(true);
    const fdFlag = result.risks!.find((r) => r.category === 'flood')!;
    expect(fdFlag.dataAvailable).toBe(true);
  });

  it('heritage throws → degrade; bushfire and flood still returned', async () => {
    mockQueryBushfire.mockResolvedValue(bushfireFlag);
    mockQueryHeritage.mockRejectedValue(new Error('Timeout'));
    mockQueryFlood.mockResolvedValue(floodFlag);

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchRisks(state);

    const htFlag = result.risks!.find((r) => r.category === 'heritage')!;
    expect(htFlag.dataAvailable).toBe(false);

    expect(result.risks!.find((r) => r.category === 'bushfire')!.dataAvailable).toBe(true);
    expect(result.risks!.find((r) => r.category === 'flood')!.dataAvailable).toBe(true);
  });

  it('flood throws → degrade; bushfire and heritage still returned', async () => {
    mockQueryBushfire.mockResolvedValue(null);
    mockQueryHeritage.mockResolvedValue(null);
    mockQueryFlood.mockRejectedValue(new Error('Network error'));

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchRisks(state);

    const fdFlag = result.risks!.find((r) => r.category === 'flood')!;
    expect(fdFlag.dataAvailable).toBe(false);
    expect(fdFlag.description).toBe('Risk data unavailable (source error).');

    // null-adapter categories get 'None identified.' (not degrade)
    expect(result.risks!.find((r) => r.category === 'bushfire')!.description).toBe(
      'None identified.',
    );
    expect(result.risks!.find((r) => r.category === 'heritage')!.description).toBe(
      'None identified.',
    );
  });

  it('all three adapters throw → all three degrade flags', async () => {
    mockQueryBushfire.mockRejectedValue(new Error('fail'));
    mockQueryHeritage.mockRejectedValue(new Error('fail'));
    mockQueryFlood.mockRejectedValue(new Error('fail'));

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchRisks(state);

    expect(result.risks).toHaveLength(3);
    for (const flag of result.risks!) {
      expect(flag.dataAvailable).toBe(false);
    }
    // Still no graph-level error — graceful degrade
    expect(result.errors).toBeUndefined();
  });

  it('resolveLga throws → degrades to null (conservative flood), node does not crash', async () => {
    mockResolveLga.mockRejectedValue(new Error('LGA service 503'));
    mockQueryBushfire.mockResolvedValue(null);
    mockQueryHeritage.mockResolvedValue(null);
    // With lga unresolved, queryFlood gets null and returns its conservative
    // (dataAvailable:false) branch — never a false "no flood risk".
    mockQueryFlood.mockResolvedValue({
      category: 'flood',
      severity: 'informational',
      description:
        'NSW has not published LEP flood-planning mapping for this LGA — assess flood risk separately.',
      dataAvailable: false,
      sourceRef: null,
      evidence: null,
    });

    const state = graphState({ resolvedAddress: NSW_ADDRESS });
    const result = await fetchRisks(state);

    expect(result.errors).toBeUndefined(); // node did NOT crash on the LGA failure
    expect(result.risks).toHaveLength(3);
    // The resolveLga rejection was caught → queryFlood invoked with null lga.
    expect(mockQueryFlood).toHaveBeenCalledWith(NSW_ADDRESS.lat, NSW_ADDRESS.lng, null);
    expect(result.risks!.find((r) => r.category === 'flood')!.dataAvailable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test: annotation `risks` reducer merges by category
// (mirrors the comparables-reducer test in state-helpers.test.ts)
// ---------------------------------------------------------------------------

describe('annotation risks reducer — mergeByKey(category)', () => {
  const merge = mergeByKey<RiskFlag>('category');

  it('adds new categories and preserves existing ones', () => {
    const current: RiskFlag[] = [
      {
        category: 'flood',
        severity: 'high',
        description: 'Flood area',
        dataAvailable: true,
        sourceRef: null,
        evidence: null,
      },
    ];
    const incoming: RiskFlag[] = [
      {
        category: 'bushfire',
        severity: 'medium',
        description: 'Bushfire zone',
        dataAvailable: true,
        sourceRef: null,
        evidence: null,
      },
    ];
    const result = merge(current, incoming);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.category).sort()).toEqual(['bushfire', 'flood']);
  });

  it('updates an existing category (last-write-wins)', () => {
    const current: RiskFlag[] = [
      {
        category: 'flood',
        severity: 'informational',
        description: 'Data unavailable',
        dataAvailable: false,
        sourceRef: null,
        evidence: null,
      },
    ];
    const incoming: RiskFlag[] = [
      {
        category: 'flood',
        severity: 'high',
        description: 'Flood Planning Area',
        dataAvailable: true,
        sourceRef: null,
        evidence: null,
      },
    ];
    const result = merge(current, incoming);
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('high');
    expect(result[0]!.description).toBe('Flood Planning Area');
  });

  it('crash-resumption: re-emitting one category does not wipe the others', () => {
    const afterRun1: RiskFlag[] = [
      {
        category: 'flood',
        severity: 'high',
        description: 'Flood',
        dataAvailable: true,
        sourceRef: null,
        evidence: null,
      },
      {
        category: 'bushfire',
        severity: 'medium',
        description: 'Bushfire',
        dataAvailable: true,
        sourceRef: null,
        evidence: null,
      },
    ];
    const run2Output: RiskFlag[] = [
      {
        category: 'heritage',
        severity: 'informational',
        description: 'None identified.',
        dataAvailable: true,
        sourceRef: null,
        evidence: null,
      },
    ];
    const result = merge(afterRun1, run2Output);
    expect(result.map((r) => r.category).sort()).toEqual(['bushfire', 'flood', 'heritage']);
  });

  it('handles empty current or incoming', () => {
    const flag: RiskFlag = {
      category: 'flood',
      severity: 'high',
      description: 'Flood',
      dataAvailable: true,
      sourceRef: null,
      evidence: null,
    };
    expect(merge(undefined, [flag])).toEqual([flag]);
    expect(merge([flag], undefined)).toEqual([flag]);
  });
});
