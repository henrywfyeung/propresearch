// tests/unit/selectComparables.test.ts
import { runWithReportContext } from '@/agents/reportContext';
import { selectComparables } from '@/tools/comps/selectComparables';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const HOST = 'realty-base-au.p.rapidapi.com';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());
beforeEach(() => {
  process.env.RAPIDAPI_KEY = 'test-key';
  process.env.RAPIDAPI_REA_HOST = HOST;
  // Pin Date only (keep setTimeout real so pRetry/MSW are unaffected).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-30T00:00:00Z'));
});

const SUBJECT = {
  subject: { beds: 3, baths: 2, landArea: 500, propertyType: 'House' },
  geo: { lat: -33.82, lng: 151.24 },
  location: { suburb: 'Mosman', state: 'NSW', postcode: '2088' },
};

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

function listing(id: string, o: ListingOpts) {
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

function mockRea(o: { ac?: unknown; page1: unknown[]; capture?: (url: string) => void }) {
  server.use(
    http.get(`https://${HOST}/auto-complete`, () => HttpResponse.json(o.ac ?? autoCompleteOk)),
    http.get(`https://${HOST}/properties/search`, ({ request }) => {
      o.capture?.(request.url);
      const page = new URL(request.url).searchParams.get('page');
      return HttpResponse.json(soldPage(page === '1' ? o.page1 : []));
    }),
  );
}

describe('selectComparables', () => {
  it('ranks a near, same-bed comp above a far, bed-mismatched comp', async () => {
    mockRea({
      page1: [
        listing('FAR', { beds: 5, lat: -33.86, lng: 151.2 }),
        listing('NEAR', { beds: 3, lat: -33.8201, lng: 151.2401 }),
      ],
    });
    const out = await runWithReportContext({ reportId: 'r1' }, () => selectComparables(SUBJECT));
    expect(out.map((c) => c.id)).toEqual(['NEAR', 'FAR']);
    expect(out[0]?.similarityScore).toBeGreaterThan(out[1]?.similarityScore ?? 0);
  });

  it('caps at maxCandidates, keeping the highest scorers', async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      listing(`L${i}`, { lat: -33.82 - i * 0.0006 }),
    );
    mockRea({ page1: many });
    const out = await runWithReportContext({ reportId: 'r2' }, () =>
      selectComparables(SUBJECT, { maxCandidates: 30 }),
    );
    expect(out).toHaveLength(30);
    expect(out[0]?.id).toBe('L0');
  });

  it('populates similarityScore and keeps selection=candidate', async () => {
    mockRea({ page1: [listing('A', {})] });
    const out = await runWithReportContext({ reportId: 'r3' }, () => selectComparables(SUBJECT));
    expect(out[0]?.similarityScore).toBeGreaterThan(0);
    expect(out[0]?.selection).toBe('candidate');
  });

  it('falls back to a built locationId when auto-complete is empty', async () => {
    let searchUrl = '';
    mockRea({
      ac: { status: true, data: [] },
      page1: [listing('A', {})],
      capture: (u) => {
        searchUrl = u;
      },
    });
    await runWithReportContext({ reportId: 'r4' }, () => selectComparables(SUBJECT));
    // URLSearchParams decodes the form-encoded query (incl. '+' → space), which
    // decodeURIComponent does not; assert the exact fallback locationId reached REA.
    expect(new URL(searchUrl).searchParams.get('locationId')).toBe('suburb:Mosman, NSW 2088');
  });

  it('returns an empty array when REA yields no comps', async () => {
    mockRea({ page1: [] });
    const out = await runWithReportContext({ reportId: 'r5' }, () => selectComparables(SUBJECT));
    expect(out).toEqual([]);
  });

  it('applies the recency deduction via the injected now', async () => {
    mockRea({
      page1: [
        listing('OLD', { dateSold: '2026-01-15' }),
        listing('NEW', { dateSold: '2026-05-23' }),
      ],
    });
    const out = await runWithReportContext({ reportId: 'r6' }, () =>
      selectComparables(SUBJECT, { now: new Date('2026-05-30T00:00:00Z') }),
    );
    expect(out.map((c) => c.id)).toEqual(['NEW', 'OLD']);
    expect(out[0]?.similarityScore).toBeGreaterThan(out[1]?.similarityScore ?? 0);
  });
});
