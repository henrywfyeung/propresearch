// tests/unit/fetchSchools.test.ts — Node 14: nearby schools → state.schools.

import { fetchSchools } from '@/agents/nodes/14_fetchSchools';
import * as ga from '@/tools/schools/ga';
// biome-ignore lint/suspicious/noExplicitAny: minimal graph-state stubs
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/tools/schools/ga', () => ({ fetchNearbyFacilities: vi.fn() }));

const RA = {
  lat: -37.82,
  lng: 144.99,
  suburb: 'Richmond',
  postcode: '3121',
  state: 'VIC' as const,
  normalizedAddress: 'x',
};

describe('fetchSchools', () => {
  it('writes nearby facilities into state.schools', async () => {
    vi.mocked(ga.fetchNearbyFacilities).mockResolvedValue([
      { name: 'Richmond Primary School', type: 'primary', lat: -37.82, lng: 144.99, distanceM: 700 },
    ]);
    // biome-ignore lint/suspicious/noExplicitAny: minimal state
    const out = await fetchSchools({ resolvedAddress: RA } as any);
    expect(out.schools).toHaveLength(1);
    expect(out.schools?.[0]?.type).toBe('primary');
  });

  it('errors in-band when there is no resolvedAddress', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal state
    const out = await fetchSchools({} as any);
    expect(out.errors?.[0]?.code).toBe('PARTIAL_DATA');
  });

  it('degrades to an empty list when the tool rejects', async () => {
    vi.mocked(ga.fetchNearbyFacilities).mockRejectedValue(new Error('GA down'));
    // biome-ignore lint/suspicious/noExplicitAny: minimal state
    const out = await fetchSchools({ resolvedAddress: RA } as any);
    expect(out.schools).toEqual([]);
  });
});
