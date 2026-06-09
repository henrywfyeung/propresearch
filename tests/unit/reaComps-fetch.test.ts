// tests/unit/reaComps-fetch.test.ts
import { runWithReportContext } from '@/agents/reportContext';
import { fetchReaSoldComparables } from '@/tools/comps/reaComps';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const HOST = 'realty-base-au.p.rapidapi.com';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  process.env.RAPIDAPI_KEY = 'test-key';
  process.env.RAPIDAPI_REA_HOST = HOST;
});

const listing = (id: string, value: string, dateSold: string) => ({
  listingId: id,
  propertyType: 'apartment',
  price: { display: value },
  dateSold: { value: dateSold },
  features: { general: { bedrooms: 2, bathrooms: 1, parkingSpaces: 1 } },
  address: {
    streetAddress: `${id} St`,
    suburb: 'Mosman',
    state: 'NSW',
    postcode: '2088',
    location: { latitude: -33.82, longitude: 151.24 },
  },
  images: [],
});

describe('fetchReaSoldComparables', () => {
  it('keeps recent priced comps, drops withheld + stale, dedupes by id', async () => {
    const recent = new Date().toISOString().slice(0, 10);
    server.use(
      http.get(`https://${HOST}/properties/search`, ({ request }) => {
        const page = new URL(request.url).searchParams.get('page');
        if (page === '1') {
          return HttpResponse.json({
            totalResultCount: 4,
            currentPage: 1,
            data: [
              listing('A', '$1,000,000', recent), // keep
              listing('B', 'Price Withheld', recent), // drop (no price)
              listing('C', '$900,000', '2019-01-01'), // drop (stale)
              listing('A', '$1,000,000', recent), // dup of A
            ],
          });
        }
        return HttpResponse.json({ totalResultCount: 4, currentPage: 2, data: [] });
      }),
    );

    const comps = await runWithReportContext({ reportId: 'r1' }, () =>
      fetchReaSoldComparables({
        locationId: 'suburb:Mosman, NSW 2088',
        subject: { lat: -33.82, lng: 151.24 },
      }),
    );

    expect(comps.map((c) => c.id)).toEqual(['A']);
    expect(comps[0]?.salePrice).toBe(1000000);
  });

  it('stops paginating at an empty page', async () => {
    let calls = 0;
    server.use(
      http.get(`https://${HOST}/properties/search`, () => {
        calls += 1;
        return HttpResponse.json({ data: [] });
      }),
    );
    await runWithReportContext({ reportId: 'r2' }, () =>
      fetchReaSoldComparables({
        locationId: 'suburb:Mosman, NSW 2088',
        subject: { lat: -33.82, lng: 151.24 },
        maxPages: 3,
      }),
    );
    expect(calls).toBe(1); // first page empty → stop
  });
});
