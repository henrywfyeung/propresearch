// tests/unit/listingMedia.test.ts
import { runWithReportContext } from '@/agents/reportContext';
import { fetchListingMedia } from '@/tools/rapidapi/listingMedia';
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

// --- fixtures -----------------------------------------------------------

const autoCompleteWithListing = {
  status: true,
  data: [
    {
      type: 'listing',
      id: '151106864',
      locationId: 'listing:2/25 Mosman Street, Mosman, NSW 2088',
      source: {
        url: 'https://www.realestate.com.au/151106864',
        image:
          'https://i2.au.reastatic.net/{size}/05dea9e4bd6f91dc8535fee081dd77f6b66fbed9edc44385b2a6c13c88436be9/image.jpg',
        channel: 'buy',
      },
      display: { text: '2/25 Mosman Street, Mosman, NSW 2088', subtext: 'For sale' },
    },
    {
      type: 'address',
      id: '1174525',
      locationId: 'address:2/25 Mosman St, Mosman, NSW 2088',
      source: { name: 'Mosman', postcode: '2088', state: 'NSW' },
      display: { text: '2/25 Mosman St, Mosman, NSW 2088' },
    },
  ],
};

const autoCompleteNoListing = {
  status: true,
  data: [
    {
      type: 'suburb',
      id: 's1',
      locationId: 'suburb:Mosman, NSW 2088',
      source: { name: 'Mosman', postcode: '2088', state: 'NSW' },
      display: { text: 'Mosman, NSW 2088' },
    },
  ],
};

// Listing detail response — data is a dict (the single listing object)
// with a mix of photo, floorplan, and video images.
const listingDetailResponse = {
  status: true,
  data: {
    listingId: 151106864,
    propertyType: 'apartment',
    images: [
      { server: 'https://i3.au.reastatic.net', name: 'photo', uri: '/hash1/image.jpg' },
      { server: 'https://i3.au.reastatic.net', name: 'main photo', uri: '/hash2/image.jpg' },
      { server: 'https://i3.au.reastatic.net', name: 'photo', uri: '/hash3/image.jpg' },
      { server: 'https://i3.au.reastatic.net', name: 'floorplan', uri: '/fphash/image.jpg' },
      // video thumbnail — should be dropped
      {
        server: 'https://img.youtube.com',
        name: 'video',
        uri: '/vi/dQw4w9WgXcQ/image.jpg',
      },
    ],
  },
};

// --- helpers -----------------------------------------------------------

function useStandardHandlers() {
  server.use(
    http.get(`https://${HOST}/auto-complete`, () => HttpResponse.json(autoCompleteWithListing)),
    http.get(`https://${HOST}/properties/search`, () => HttpResponse.json(listingDetailResponse)),
  );
}

// --- tests -------------------------------------------------------------

describe('fetchListingMedia', () => {
  it('finds the listing suggestion, fetches images, splits photos vs floorplans, builds size URLs', async () => {
    useStandardHandlers();
    const result = await runWithReportContext({ reportId: 'r1' }, () =>
      fetchListingMedia('2/25 Mosman Street, Mosman NSW 2088'),
    );

    expect(result).not.toBeNull();
    expect(result?.listingUrl).toBe('https://www.realestate.com.au/151106864');

    // 2 'photo' + 1 'main photo' = 3 photos
    expect(result?.photos).toHaveLength(3);
    expect(result?.photos[0]).toBe(
      'https://i3.au.reastatic.net/1920x1080-format=jpg/hash1/image.jpg',
    );
    expect(result?.photos[1]).toBe(
      'https://i3.au.reastatic.net/1920x1080-format=jpg/hash2/image.jpg',
    );
    expect(result?.photos[2]).toBe(
      'https://i3.au.reastatic.net/1920x1080-format=jpg/hash3/image.jpg',
    );

    // 1 floorplan
    expect(result?.floorplans).toHaveLength(1);
    expect(result?.floorplans[0]).toBe(
      'https://i3.au.reastatic.net/1920x1080-format=jpg/fphash/image.jpg',
    );
  });

  it('drops video entries (name=video)', async () => {
    useStandardHandlers();
    const result = await runWithReportContext({ reportId: 'r2' }, () =>
      fetchListingMedia('2/25 Mosman Street, Mosman NSW 2088'),
    );
    // Videos should not appear in photos or floorplans
    const allUrls = [...(result?.photos ?? []), ...(result?.floorplans ?? [])];
    expect(allUrls.every((u) => !u.includes('youtube.com'))).toBe(true);
  });

  it('returns null when no listing suggestion exists', async () => {
    server.use(
      http.get(`https://${HOST}/auto-complete`, () => HttpResponse.json(autoCompleteNoListing)),
    );
    const result = await runWithReportContext({ reportId: 'r3' }, () =>
      fetchListingMedia('Some Unknown Address'),
    );
    expect(result).toBeNull();
  });

  it(
    'returns null on network error (graceful degradation)',
    async () => {
      server.use(http.get(`https://${HOST}/auto-complete`, () => HttpResponse.error()));
      const result = await runWithReportContext({ reportId: 'r4' }, () =>
        fetchListingMedia('2/25 Mosman Street, Mosman NSW 2088'),
      );
      expect(result).toBeNull();
    },
    20_000, // pRetry exhausts up to ~15s (4 retries, exponential backoff)
  );
});
