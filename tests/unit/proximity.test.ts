// tests/unit/proximity.test.ts — nearest transmission line (GA) + freeway (OSM).

import { fetchNearestFreeway, fetchNearestTransmission } from '@/tools/proximity/proximity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SUBJECT = { lat: -37.8243, lng: 144.9945 };
const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('fetchNearestTransmission', () => {
  it('picks the nearest line and labels it with kV + name', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      json({
        features: [
          { attributes: { name: 'Far Line', capacitykv: 500 }, geometry: { paths: [[[145.1, -37.95]]] } },
          { attributes: { name: 'Near Line', capacitykv: 66 }, geometry: { paths: [[[144.995, -37.8245]]] } },
        ],
      }),
    );
    const r = await fetchNearestTransmission(SUBJECT);
    expect(r?.label).toContain('66 kV');
    expect(r?.label).toContain('Near Line');
    expect(r?.distanceM).toBeLessThan(200);
  });

  it('returns null on a non-2xx response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false } as Response);
    expect(await fetchNearestTransmission(SUBJECT)).toBeNull();
  });
});

describe('fetchNearestFreeway', () => {
  it('returns the nearest motorway ref and sends a User-Agent (Overpass needs it)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      json({ elements: [{ tags: { ref: 'M1' }, geometry: [{ lat: -37.8244, lon: 144.9946 }] }] }),
    );
    const r = await fetchNearestFreeway(SUBJECT);
    expect(r?.label).toBe('M1');
    expect(r?.distanceM).toBeLessThan(200);
    const init = vi.mocked(global.fetch).mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBeTruthy();
  });

  it('returns null when no motorway nearby', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(json({ elements: [] }));
    expect(await fetchNearestFreeway(SUBJECT)).toBeNull();
  });
});
