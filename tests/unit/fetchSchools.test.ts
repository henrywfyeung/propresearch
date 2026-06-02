// tests/unit/fetchSchools.test.ts — Node 14: nearby schools + hospitals → state.

import { fetchSchools } from '@/agents/nodes/14_fetchSchools';
import * as ga from '@/tools/schools/ga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/tools/schools/ga', () => ({
  fetchNearbyFacilities: vi.fn(),
  fetchNearbyHospitals: vi.fn(),
}));

const RA = {
  lat: -37.82,
  lng: 144.99,
  suburb: 'Richmond',
  postcode: '3121',
  state: 'VIC' as const,
  normalizedAddress: 'x',
};

beforeEach(() => {
  vi.mocked(ga.fetchNearbyFacilities).mockResolvedValue([]);
  vi.mocked(ga.fetchNearbyHospitals).mockResolvedValue([]);
});

describe('fetchSchools', () => {
  it('writes nearby schools AND hospitals into state', async () => {
    vi.mocked(ga.fetchNearbyFacilities).mockResolvedValue([
      { name: 'Richmond Primary School', type: 'primary', lat: -37.82, lng: 144.99, distanceM: 700 },
    ]);
    vi.mocked(ga.fetchNearbyHospitals).mockResolvedValue([
      { name: 'Epworth Richmond', lat: -37.82, lng: 144.99, distanceM: 774 },
    ]);
    // biome-ignore lint/suspicious/noExplicitAny: minimal state
    const out = await fetchSchools({ resolvedAddress: RA } as any);
    expect(out.schools?.[0]?.type).toBe('primary');
    expect(out.hospitals?.[0]?.name).toBe('Epworth Richmond');
  });

  it('caps hospitals to keep state lean', async () => {
    vi.mocked(ga.fetchNearbyHospitals).mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ name: `H${i}`, lat: 0, lng: 0, distanceM: i })),
    );
    // biome-ignore lint/suspicious/noExplicitAny: minimal state
    const out = await fetchSchools({ resolvedAddress: RA } as any);
    expect((out.hospitals?.length ?? 0)).toBeLessThanOrEqual(8);
  });

  it('errors in-band when there is no resolvedAddress', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal state
    const out = await fetchSchools({} as any);
    expect(out.errors?.[0]?.code).toBe('PARTIAL_DATA');
  });

  it('degrades to empty lists when a tool rejects', async () => {
    vi.mocked(ga.fetchNearbyFacilities).mockRejectedValue(new Error('GA down'));
    vi.mocked(ga.fetchNearbyHospitals).mockRejectedValue(new Error('GA down'));
    // biome-ignore lint/suspicious/noExplicitAny: minimal state
    const out = await fetchSchools({ resolvedAddress: RA } as any);
    expect(out.schools).toEqual([]);
    expect(out.hospitals).toEqual([]);
  });
});
