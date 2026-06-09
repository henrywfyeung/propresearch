// tests/unit/fetchCatchments.test.ts — Node 17: address -> zoned schools.

import { fetchCatchments } from '@/agents/nodes/17_fetchCatchments';
import { findCatchments } from '@/tools/schools/catchments';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphState } from '../fixtures/comps';

vi.mock('@/tools/schools/catchments', () => ({ findCatchments: vi.fn() }));
const mock = vi.mocked(findCatchments);
afterEach(() => mock.mockReset());

describe('fetchCatchments (Node 17)', () => {
  it('passes the resolved lat/lng/state to findCatchments and returns the result', async () => {
    const result = {
      primary: { school: 'Mosman PS', level: 'primary' as const, catchType: 'PRIMARY' },
      secondary: { school: 'Mosman HS', level: 'secondary' as const, catchType: 'HIGH_COED' },
    };
    mock.mockReturnValue(result);
    const out = await fetchCatchments(graphState());
    expect(mock).toHaveBeenCalledWith(-33.82, 151.24, 'NSW');
    expect(out.catchments).toEqual(result);
  });

  it('returns an empty patch when there is no resolved address', async () => {
    const out = await fetchCatchments(graphState({ resolvedAddress: null }));
    expect(out).toEqual({});
    expect(mock).not.toHaveBeenCalled();
  });
});
