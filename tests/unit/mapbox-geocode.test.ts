// tests/unit/mapbox-geocode.test.ts
import { forwardGeocode } from '@/tools/mapbox/geocode';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  process.env.MAPBOX_TOKEN = 'test-token';
});

const v6 = {
  features: [
    {
      properties: {
        full_address: '1 Awaba St, Mosman NSW 2088, Australia',
        name: '1 Awaba St',
        coordinates: { longitude: 151.2454, latitude: -33.8284 },
        context: {
          region: { name: 'New South Wales', region_code: 'NSW' },
          postcode: { name: '2088' },
          locality: { name: 'Mosman' },
          place: { name: 'Sydney' },
        },
      },
      geometry: { type: 'Point', coordinates: [151.2454, -33.8284] },
    },
  ],
};

describe('forwardGeocode', () => {
  it('extracts suburb/postcode/state from the v6 context', async () => {
    server.use(
      http.get('https://api.mapbox.com/search/geocode/v6/forward', () => HttpResponse.json(v6)),
    );
    const out = await forwardGeocode('1 Awaba St Mosman');
    expect(out).not.toBeNull();
    expect(out?.lat).toBeCloseTo(-33.8284, 3);
    expect(out?.suburb).toBe('Mosman');
    expect(out?.postcode).toBe('2088');
    expect(out?.state).toBe('NSW');
  });

  it('returns null fields when context is absent', async () => {
    server.use(
      http.get('https://api.mapbox.com/search/geocode/v6/forward', () =>
        HttpResponse.json({
          features: [
            { properties: { name: 'X' }, geometry: { type: 'Point', coordinates: [151, -33] } },
          ],
        }),
      ),
    );
    const out = await forwardGeocode('nowhere');
    expect(out?.suburb).toBeNull();
    expect(out?.state).toBeNull();
  });
});
