// tests/unit/rea-adapter.test.ts
import { runWithReportContext } from '@/agents/reportContext';
import { reaAutoComplete, reaSearchSold } from '@/tools/rapidapi/rea';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import soldPage from '../fixtures/rea-sold-page.json';

const HOST = 'realty-base-au.p.rapidapi.com';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  process.env.RAPIDAPI_KEY = 'test-key';
  process.env.RAPIDAPI_REA_HOST = HOST;
});

describe('reaAutoComplete', () => {
  it('returns location items with a locationId', async () => {
    server.use(
      http.get(`https://${HOST}/auto-complete`, () =>
        HttpResponse.json({
          status: true,
          data: [
            { locationId: 'suburb:Mosman, NSW 2088', type: 'suburb',
              display: { text: 'Mosman, NSW 2088', subtext: 'Suburb' },
              source: { name: 'Mosman', postcode: '2088', state: 'NSW' } },
          ],
        }),
      ),
    );
    const out = await runWithReportContext({ reportId: 'r1' }, () => reaAutoComplete('Mosman'));
    expect(out[0]?.locationId).toBe('suburb:Mosman, NSW 2088');
  });
});

describe('reaSearchSold', () => {
  it('parses the sold page into listing objects, keeping only dateSold items', async () => {
    server.use(http.get(`https://${HOST}/properties/search`, () => HttpResponse.json(soldPage)));
    const out = await runWithReportContext({ reportId: 'r2' }, () =>
      reaSearchSold('suburb:Mosman, NSW 2088', 1),
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.listingId).toBe('150833140');
    expect(out[0]?.dateSold?.value).toBe('2026-05-26');
    expect(out[0]?.address?.location?.latitude).toBeCloseTo(-33.8183, 3);
  });

  it('sends channel=sold and the page param', async () => {
    let url = '';
    server.use(
      http.get(`https://${HOST}/properties/search`, ({ request }) => {
        url = request.url;
        return HttpResponse.json(soldPage);
      }),
    );
    await runWithReportContext({ reportId: 'r3' }, () => reaSearchSold('suburb:Mosman, NSW 2088', 2));
    expect(url).toContain('channel=sold');
    expect(url).toContain('page=2');
    expect(url).toContain('locationId=suburb');
  });
});
