// tests/fixtures/comps.ts — shared REA MSW mocks + graph-state fixtures.
import type { GraphState } from '@/agents/annotation';
import type { ResolvedAddress, SubjectProperty } from '@/schemas/state';
import { http, HttpResponse } from 'msw';
import type { setupServer } from 'msw/node';

type Server = ReturnType<typeof setupServer>;

export const REA_HOST = 'realty-base-au.p.rapidapi.com';

interface ListingOpts {
  beds?: number;
  baths?: number;
  landArea?: number;
  propertyType?: string;
  price?: string;
  dateSold?: string;
  lat?: number;
  lng?: number;
}

export function listing(id: string, o: ListingOpts = {}) {
  return {
    listingId: id,
    propertyType: o.propertyType ?? 'house',
    price: { display: o.price ?? '$1,500,000' },
    dateSold: { value: o.dateSold ?? '2026-05-23' },
    landSize: { value: o.landArea ?? 500, unit: 'm2' },
    features: { general: { bedrooms: o.beds ?? 3, bathrooms: o.baths ?? 2, parkingSpaces: 1 } },
    address: {
      streetAddress: `${id} St`,
      suburb: 'Mosman',
      state: 'NSW',
      postcode: '2088',
      location: { latitude: o.lat ?? -33.82, longitude: o.lng ?? 151.24 },
    },
    images: [],
  };
}

const autoCompleteOk = {
  status: true,
  data: [{ locationId: 'suburb:Mosman, NSW 2088', type: 'suburb', display: { text: 'Mosman' } }],
};

function soldPage(listings: unknown[]) {
  return { totalResultCount: listings.length, currentPage: 1, data: listings };
}

/** Auto-complete OK + a single page of sold listings. */
export function mockReaOk(server: Server, page1: unknown[]) {
  server.use(
    http.get(`https://${REA_HOST}/auto-complete`, () => HttpResponse.json(autoCompleteOk)),
    http.get(`https://${REA_HOST}/properties/search`, ({ request }) => {
      const page = new URL(request.url).searchParams.get('page');
      return HttpResponse.json(soldPage(page === '1' ? page1 : []));
    }),
  );
}

/** Auto-complete OK, but the sold search is blocked (403 — non-retryable, fast). */
export function mockReaBlocked(server: Server) {
  server.use(
    http.get(`https://${REA_HOST}/auto-complete`, () => HttpResponse.json(autoCompleteOk)),
    http.get(
      `https://${REA_HOST}/properties/search`,
      () => new HttpResponse(null, { status: 403 }),
    ),
  );
}

export const sampleResolvedAddress: ResolvedAddress = {
  lat: -33.82,
  lng: 151.24,
  suburb: 'Mosman',
  postcode: '2088',
  state: 'NSW',
  normalizedAddress: '1 Example St, Mosman NSW 2088',
};

export const sampleSubject: SubjectProperty = {
  attrs: {
    beds: 3,
    baths: 2,
    parking: 1,
    landArea: 500,
    buildingArea: null,
    propertyType: 'House',
  },
  photos: [],
  listing: null,
  visionAnalysis: null,
  streetView: null,
};

/** Build a full GraphState, overriding any channel. */
export function graphState(over: Partial<GraphState> = {}): GraphState {
  return {
    reportId: 'r1',
    resolvedAddress: sampleResolvedAddress,
    subject: sampleSubject,
    comparables: [],
    errors: [],
    ...over,
  };
}
