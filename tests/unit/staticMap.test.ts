// tests/unit/staticMap.test.ts
import { staticMapDataUrl } from '@/tools/mapbox/staticMap';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SUBJECT = { lat: -33.82, lng: 151.24 };
const COMPS = [
  { lat: -33.83, lng: 151.25 },
  { lat: -33.81, lng: 151.23 },
];

function mockFetchOk(png = new Uint8Array([137, 80, 78, 71])) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => png.buffer,
  } as unknown as Response);
}

function mockFetchStatus(status: number) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
  } as unknown as Response);
}

function mockFetchThrow(err = new Error('network error')) {
  global.fetch = vi.fn().mockRejectedValue(err);
}

beforeEach(() => {
  process.env.MAPBOX_TOKEN = 'pk.test-token';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.MAPBOX_TOKEN = '';
});

describe('staticMapDataUrl', () => {
  it('builds a URL containing the navy subject marker (1f3864)', async () => {
    mockFetchOk();
    await staticMapDataUrl(SUBJECT, COMPS);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(url).toContain('pin-s+1f3864');
    expect(url).toContain(`${SUBJECT.lng},${SUBJECT.lat}`);
  });

  it('builds a URL containing grey comp markers (888888)', async () => {
    mockFetchOk();
    await staticMapDataUrl(SUBJECT, COMPS);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(url).toContain('pin-s+888888');
    for (const c of COMPS) {
      expect(url).toContain(`${c.lng},${c.lat}`);
    }
  });

  it('includes "auto" for auto-fit viewport', async () => {
    mockFetchOk();
    await staticMapDataUrl(SUBJECT, COMPS);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(url).toContain('/auto/');
  });

  it('includes the Mapbox token as access_token query param', async () => {
    mockFetchOk();
    await staticMapDataUrl(SUBJECT, COMPS);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(url).toContain('access_token=pk.test-token');
  });

  it('returns a data:image/png;base64 string on 2xx', async () => {
    mockFetchOk();
    const result = await staticMapDataUrl(SUBJECT, COMPS);
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it('returns null on a non-2xx response', async () => {
    mockFetchStatus(403);
    const result = await staticMapDataUrl(SUBJECT, COMPS);
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    mockFetchThrow();
    const result = await staticMapDataUrl(SUBJECT, COMPS);
    expect(result).toBeNull();
  });

  it('returns null when MAPBOX_TOKEN is not set', async () => {
    process.env.MAPBOX_TOKEN = '';
    global.fetch = vi.fn();
    const result = await staticMapDataUrl(SUBJECT, COMPS);
    expect(result).toBeNull();
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it('caps comp markers at 15 (URL length safety)', async () => {
    mockFetchOk();
    const manyComps = Array.from({ length: 20 }, (_, i) => ({
      lat: -33.82 + i * 0.001,
      lng: 151.24 + i * 0.001,
    }));
    await staticMapDataUrl(SUBJECT, manyComps);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    // Count grey pin occurrences
    const greyPins = (url.match(/pin-s\+888888/g) ?? []).length;
    expect(greyPins).toBe(15);
  });

  it('still returns a result when comps array is empty (subject-only map)', async () => {
    mockFetchOk();
    const result = await staticMapDataUrl(SUBJECT, []);
    expect(result).toMatch(/^data:image\/png;base64,/);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(url).toContain('pin-s+1f3864');
    expect(url).not.toContain('pin-s+888888');
  });
});
