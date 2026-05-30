import { resolveAddress } from '@/agents/nodes/01_resolveAddress';
import { AddressResolutionError, UnsupportedRegionError } from '@/lib/errors';
import { forwardGeocode } from '@/tools/mapbox/geocode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// tests/unit/resolveAddress.test.ts
import { graphState } from '../fixtures/comps';

vi.mock('@/tools/mapbox/geocode', () => ({ forwardGeocode: vi.fn() }));
const mockGeocode = vi.mocked(forwardGeocode);

const geo = (over = {}) => ({
  lat: -33.8284,
  lng: 151.2454,
  confidence: 1,
  matchedAddress: '1 Awaba St, Mosman NSW 2088',
  suburb: 'Mosman',
  postcode: '2088',
  state: 'NSW',
  ...over,
});

beforeEach(() => mockGeocode.mockReset());

describe('resolveAddress', () => {
  it('emits a ResolvedAddress on a good geocode', async () => {
    mockGeocode.mockResolvedValue(geo());
    const out = await resolveAddress(graphState({ rawAddress: '1 Awaba St Mosman' }));
    expect(out.resolvedAddress?.suburb).toBe('Mosman');
    expect(out.resolvedAddress?.state).toBe('NSW');
    expect(out.resolvedAddress?.normalizedAddress).toBe('1 Awaba St, Mosman NSW 2088');
  });

  it('throws AddressResolutionError when rawAddress is empty', async () => {
    await expect(resolveAddress(graphState({ rawAddress: '' }))).rejects.toBeInstanceOf(
      AddressResolutionError,
    );
  });

  it('throws AddressResolutionError when geocode returns null', async () => {
    mockGeocode.mockResolvedValue(null);
    await expect(resolveAddress(graphState({ rawAddress: 'x' }))).rejects.toBeInstanceOf(
      AddressResolutionError,
    );
  });

  it('throws UnsupportedRegionError for a non-NSW/VIC/WA state', async () => {
    mockGeocode.mockResolvedValue(geo({ state: 'QLD' }));
    await expect(resolveAddress(graphState({ rawAddress: 'x' }))).rejects.toBeInstanceOf(
      UnsupportedRegionError,
    );
  });

  it('throws AddressResolutionError when the geocode is missing a suburb', async () => {
    mockGeocode.mockResolvedValue(geo({ suburb: null }));
    await expect(resolveAddress(graphState({ rawAddress: 'x' }))).rejects.toBeInstanceOf(
      AddressResolutionError,
    );
  });
});
