// tests/unit/staticMap.test.ts
import { interactiveMapHref, staticMapDataUrl } from '@/tools/mapbox/staticMap';
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
  it('builds a URL containing the large navy home subject marker (1f3864)', async () => {
    mockFetchOk();
    await staticMapDataUrl(SUBJECT, COMPS);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(url).toContain('pin-l-home+1f3864');
    expect(url).toContain(`${SUBJECT.lng},${SUBJECT.lat}`);
  });

  it('uses the full-colour streets-v12 base style', async () => {
    mockFetchOk();
    await staticMapDataUrl(SUBJECT, COMPS);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(url).toContain('/styles/v1/mapbox/streets-v12/');
    expect(url).not.toContain('light-v11');
  });

  it('uses small slate comp markers when unlabelled', async () => {
    mockFetchOk();
    await staticMapDataUrl(SUBJECT, COMPS);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(url).toContain('pin-s+5b6573');
    for (const c of COMPS) {
      expect(url).toContain(`${c.lng},${c.lat}`);
    }
  });

  it('uses numbered medium pins when comps carry labels (keys the legend)', async () => {
    mockFetchOk();
    const labelled = COMPS.map((c, i) => ({ ...c, label: String(i + 1) }));
    await staticMapDataUrl(SUBJECT, labelled);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(url).toContain('pin-m-1+5b6573');
    expect(url).toContain('pin-m-2+5b6573');
    expect(url).not.toContain('pin-s+5b6573'); // labelled → medium, not small
  });

  it('adds green school-glyph markers when schools are provided', async () => {
    mockFetchOk();
    await staticMapDataUrl(SUBJECT, COMPS, [
      { lat: -33.83, lng: 151.25 },
      { lat: -33.81, lng: 151.23 },
    ]);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(url).toContain('pin-s-school+2e8b57');
  });

  it('omits school markers when none are provided', async () => {
    mockFetchOk();
    await staticMapDataUrl(SUBJECT, COMPS);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(url).not.toContain('school');
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
      label: String(i + 1),
    }));
    await staticMapDataUrl(SUBJECT, manyComps);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    // Count numbered comp pin occurrences
    const compPins = (url.match(/pin-m-\d+\+5b6573/g) ?? []).length;
    expect(compPins).toBe(15);
  });

  it('still returns a result when comps array is empty (subject-only map)', async () => {
    mockFetchOk();
    const result = await staticMapDataUrl(SUBJECT, []);
    expect(result).toMatch(/^data:image\/png;base64,/);
    const url = vi.mocked(global.fetch).mock.calls[0]?.[0] as string;
    expect(url).toContain('pin-l-home+1f3864');
    expect(url).not.toContain('5b6573');
  });
});

describe('interactiveMapHref', () => {
  it('builds a Google Maps URL centred on the subject coordinates', () => {
    const href = interactiveMapHref({ lat: -33.8369, lng: 151.2345 });
    expect(href).toBe('https://www.google.com/maps/search/?api=1&query=-33.8369,151.2345');
  });

  it('does not require a Mapbox token (pure URL builder)', () => {
    process.env.MAPBOX_TOKEN = '';
    expect(() => interactiveMapHref({ lat: 0, lng: 0 })).not.toThrow();
  });
});
