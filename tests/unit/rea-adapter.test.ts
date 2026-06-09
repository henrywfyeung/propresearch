// tests/unit/rea-adapter.test.ts
import { runWithReportContext } from '@/agents/reportContext';
import { reaAutoComplete, reaListingImages, reaSearchSold, withSize } from '@/tools/rapidapi/rea';
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
            {
              locationId: 'suburb:Mosman, NSW 2088',
              type: 'suburb',
              display: { text: 'Mosman, NSW 2088', subtext: 'Suburb' },
              source: { name: 'Mosman', postcode: '2088', state: 'NSW' },
            },
          ],
        }),
      ),
    );
    const out = await runWithReportContext({ reportId: 'r1' }, () => reaAutoComplete('Mosman'));
    expect(out[0]?.locationId).toBe('suburb:Mosman, NSW 2088');
  });

  it('captures id and source.url from a listing-type suggestion', async () => {
    server.use(
      http.get(`https://${HOST}/auto-complete`, () =>
        HttpResponse.json({
          status: true,
          data: [
            {
              type: 'listing',
              id: '151106864',
              locationId: 'listing:2/25 Mosman Street, Mosman, NSW 2088',
              source: {
                url: 'https://www.realestate.com.au/151106864',
                image: 'https://i2.au.reastatic.net/{size}/abc/image.jpg',
                channel: 'buy',
              },
              display: { text: '2/25 Mosman Street, Mosman, NSW 2088', subtext: 'For sale' },
            },
          ],
        }),
      ),
    );
    const out = await runWithReportContext({ reportId: 'r1b' }, () =>
      reaAutoComplete('2/25 Mosman Street, Mosman NSW 2088'),
    );
    expect(out[0]?.type).toBe('listing');
    expect(out[0]?.id).toBe('151106864');
    expect(out[0]?.source?.url).toBe('https://www.realestate.com.au/151106864');
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
    await runWithReportContext({ reportId: 'r3' }, () =>
      reaSearchSold('suburb:Mosman, NSW 2088', 2),
    );
    expect(url).toContain('channel=sold');
    expect(url).toContain('page=2');
    expect(url).toContain('locationId=suburb');
  });
});

describe('withSize', () => {
  it('inserts the size segment between server and uri', () => {
    expect(withSize('https://i3.au.reastatic.net', '/abc123/image.jpg')).toBe(
      'https://i3.au.reastatic.net/1920x1080-format=jpg/abc123/image.jpg',
    );
  });
});

describe('reaListingImages', () => {
  it('extracts image items from a dict data response (listing locationId)', async () => {
    server.use(
      http.get(`https://${HOST}/properties/search`, () =>
        HttpResponse.json({
          status: true,
          data: {
            listingId: 151106864,
            images: [
              { server: 'https://i3.au.reastatic.net', name: 'photo', uri: '/hash1/image.jpg' },
              {
                server: 'https://i3.au.reastatic.net',
                name: 'floorplan',
                uri: '/fphash/image.jpg',
              },
              { server: 'https://img.youtube.com', name: 'video', uri: '/vi/abc/image.jpg' },
            ],
          },
        }),
      ),
    );
    const images = await runWithReportContext({ reportId: 'r4' }, () =>
      reaListingImages('listing:2/25 Mosman Street, Mosman, NSW 2088'),
    );
    expect(images).toHaveLength(3); // all returned; filtering is caller's job
    expect(images[0]?.name).toBe('photo');
    expect(images[1]?.name).toBe('floorplan');
    expect(images[2]?.name).toBe('video');
  });

  it('returns [] when data.images is absent or empty', async () => {
    server.use(
      http.get(`https://${HOST}/properties/search`, () =>
        HttpResponse.json({ status: true, data: { listingId: 1 } }),
      ),
    );
    const images = await runWithReportContext({ reportId: 'r5' }, () =>
      reaListingImages('listing:1/1 Test St'),
    );
    expect(images).toEqual([]);
  });
});
