// tests/unit/nsw-planning-onlineDa.test.ts
// MSW 2.6 tests for the NSW ePlanning Online DA client.
//
// Critical contract to verify:
//   - filters / PageNumber / PageSize are sent as HTTP HEADERS, NOT query params.
//   - Correct JSON shape for the `filters` header.
//   - Paginates across TotalPages (loops page 1..N).
//   - Parses Application[] with the strict-but-partial schema.
//   - Tolerates a record with missing optional fields.
//   - Retries on 5xx and re-throws after exhausting retries.
//   - Base URL overridable via NSW_ONLINEDA_BASE env (required for MSW intercept).

import { fetchRecentDAs } from '@/tools/nsw-planning/onlineDa';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// MSW setup
// ---------------------------------------------------------------------------

const BASE = 'http://onlineda-test.local/eplanning/data/v0/OnlineDA';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  process.env.NSW_ONLINEDA_BASE = BASE;
});

// ---------------------------------------------------------------------------
// Fixtures — sampled from live API (Mosman Municipal Council, probed 2026-06-01)
// ---------------------------------------------------------------------------

const FULL_RECORD = {
  PlanningPortalApplicationNumber: 'PAN-546923',
  DateLastUpdated: '2025-07-10T22:44:05.223',
  SubmissionDate: '2025-06-24',
  LodgementDate: '2025-06-26',
  DeterminationDate: '2025-07-10',
  CostOfDevelopment: 6021618.0,
  NumberOfNewDwellings: 2,
  NumberOfExistingLots: 1,
  NumberOfProposedLots: 2,
  CouncilApplicationNumber: '8.2021.30.3',
  ApplicationStatus: 'Determined',
  ApplicationType: 'Modification Application',
  AccompaniedByVPAFlag: 'N',
  DevelopmentSubjectToSICFlag: 'N',
  EPIVariationProposedFlag: 'N',
  SubdivisionProposedFlag: 'Y',
  DeterminationAuthority: 'Council',
  Council: { CouncilName: 'Mosman Municipal Council' },
  DevelopmentType: [
    { DevelopmentType: 'Demolition' },
    { DevelopmentType: 'Residential flat building' },
    { DevelopmentType: 'Subdivision' },
  ],
  Location: [
    {
      FullAddress: '28 MORUBEN ROAD MOSMAN 2088',
      X: '151.245565425',
      Y: '-33.822869271',
      StreetNumber1: '28',
      StreetName: 'MORUBEN',
      StreetType: 'ROAD',
      Suburb: 'MOSMAN',
      Postcode: '2088',
      State: 'New South Wales',
    },
  ],
};

/** Record with only the minimum required fields (no optional fields). */
const MINIMAL_RECORD = {
  ApplicationStatus: 'Lodged',
  LodgementDate: '2025-10-15',
  ApplicationType: 'Development Application',
  // No DevelopmentCategory, DevelopmentType, CostOfDevelopment,
  // PlanningPortalApplicationNumber
  Location: [{ X: '151.200000', Y: '-33.850000' }],
};

function makePage(
  applications: Record<string, unknown>[],
  opts: { totalPages?: number; totalCount?: number } = {},
): Record<string, unknown> {
  return {
    TotalPages: opts.totalPages ?? 1,
    TotalCount: opts.totalCount ?? applications.length,
    Application: applications,
  };
}

// ---------------------------------------------------------------------------
// Helper: capture request headers from the handler
// ---------------------------------------------------------------------------

function makeHandler(
  responseBody: Record<string, unknown>,
  captureHeaders?: (headers: Headers) => void,
) {
  return http.get(BASE, ({ request }) => {
    captureHeaders?.(request.headers);
    return HttpResponse.json(responseBody);
  });
}

// ---------------------------------------------------------------------------
// Tests: headers (not query params)
// ---------------------------------------------------------------------------

describe('fetchRecentDAs — request uses HEADERS not query params', () => {
  it('sends filters, PageNumber, PageSize as HTTP headers', async () => {
    let captured: Headers | undefined;

    server.use(
      makeHandler(makePage([FULL_RECORD]), (h) => {
        captured = h;
      }),
    );

    await fetchRecentDAs('Mosman Municipal Council', '2025-06-01');

    expect(captured).toBeDefined();
    expect(captured!.get('pagenumber')).toBe('1');
    expect(captured!.get('pagesize')).toBe('1000');

    const rawFilters = captured!.get('filters');
    expect(rawFilters).not.toBeNull();

    const parsed = JSON.parse(rawFilters!) as unknown;
    expect(parsed).toEqual({
      filters: {
        CouncilName: ['Mosman Municipal Council'],
        LodgementDateFrom: '2025-06-01',
      },
    });
  });

  it('does NOT send filters / PageNumber / PageSize as query params', async () => {
    let capturedUrl: URL | undefined;

    server.use(
      http.get(BASE, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json(makePage([FULL_RECORD]));
      }),
    );

    await fetchRecentDAs('Mosman Municipal Council', '2025-06-01');

    expect(capturedUrl).toBeDefined();
    expect(capturedUrl!.searchParams.get('filters')).toBeNull();
    expect(capturedUrl!.searchParams.get('PageNumber')).toBeNull();
    expect(capturedUrl!.searchParams.get('PageSize')).toBeNull();
    // URL should have no query params at all
    expect([...capturedUrl!.searchParams.keys()]).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: pagination
// ---------------------------------------------------------------------------

describe('fetchRecentDAs — pagination', () => {
  it('fetches only page 1 when TotalPages === 1', async () => {
    let requestCount = 0;

    server.use(
      http.get(BASE, () => {
        requestCount += 1;
        return HttpResponse.json(makePage([FULL_RECORD], { totalPages: 1 }));
      }),
    );

    const records = await fetchRecentDAs('Mosman Municipal Council', '2025-06-01');

    expect(requestCount).toBe(1);
    expect(records).toHaveLength(1);
  });

  it('paginates across TotalPages and concatenates Application arrays', async () => {
    const pageRequests: number[] = [];

    server.use(
      http.get(BASE, ({ request }) => {
        const pageHeader = request.headers.get('pagenumber');
        const page = Number(pageHeader ?? '1');
        pageRequests.push(page);

        if (page === 1) {
          return HttpResponse.json(makePage([FULL_RECORD], { totalPages: 3, totalCount: 3 }));
        }
        if (page === 2) {
          return HttpResponse.json(makePage([MINIMAL_RECORD], { totalPages: 3, totalCount: 3 }));
        }
        // page 3
        return HttpResponse.json(
          makePage([{ ...FULL_RECORD, PlanningPortalApplicationNumber: 'PAN-999' }], {
            totalPages: 3,
            totalCount: 3,
          }),
        );
      }),
    );

    const records = await fetchRecentDAs('Northern Beaches Council', '2025-01-01');

    expect(pageRequests).toEqual([1, 2, 3]);
    expect(records).toHaveLength(3);
  });

  it('sends correct PageNumber header for each page in a multi-page fetch', async () => {
    const capturedPageNumbers: string[] = [];

    server.use(
      http.get(BASE, ({ request }) => {
        const pn = request.headers.get('pagenumber') ?? '?';
        capturedPageNumbers.push(pn);
        return HttpResponse.json(makePage([MINIMAL_RECORD], { totalPages: 2, totalCount: 2 }));
        // both pages return the same body; we care about page numbers sent
      }),
    );

    await fetchRecentDAs('Test Council', '2025-01-01');

    expect(capturedPageNumbers).toEqual(['1', '2']);
  });
});

// ---------------------------------------------------------------------------
// Tests: response parsing
// ---------------------------------------------------------------------------

describe('fetchRecentDAs — response parsing', () => {
  it('parses Application[] and returns OnlineDaRecord[]', async () => {
    server.use(makeHandler(makePage([FULL_RECORD])));

    const records = await fetchRecentDAs('Mosman Municipal Council', '2025-06-01');

    expect(records).toHaveLength(1);
    const r = records[0]!;
    expect(r.ApplicationStatus).toBe('Determined');
    expect(r.LodgementDate).toBe('2025-06-26');
    expect(r.ApplicationType).toBe('Modification Application');
    expect(r.CostOfDevelopment).toBe(6021618.0);
    expect(r.PlanningPortalApplicationNumber).toBe('PAN-546923');
    expect(r.DevelopmentType).toHaveLength(3);
    expect(r.DevelopmentType![0]!.DevelopmentType).toBe('Demolition');
    expect(r.Location[0]!.X).toBe('151.245565425');
    expect(r.Location[0]!.Y).toBe('-33.822869271');
    expect(r.Location[0]!.FullAddress).toBe('28 MORUBEN ROAD MOSMAN 2088');
  });

  it('tolerates a record with missing optional fields (MINIMAL_RECORD)', async () => {
    server.use(makeHandler(makePage([MINIMAL_RECORD])));

    const records = await fetchRecentDAs('Some Council', '2025-01-01');

    expect(records).toHaveLength(1);
    const r = records[0]!;
    expect(r.ApplicationStatus).toBe('Lodged');
    expect(r.LodgementDate).toBe('2025-10-15');
    expect(r.DevelopmentCategory).toBeUndefined();
    expect(r.DevelopmentType).toBeUndefined();
    expect(r.CostOfDevelopment).toBeUndefined();
    expect(r.PlanningPortalApplicationNumber).toBeUndefined();
    expect(r.Location[0]!.FullAddress).toBeUndefined();
  });

  it('returns an empty array when Application[] is empty', async () => {
    server.use(makeHandler(makePage([])));

    const records = await fetchRecentDAs('Tiny Council', '2025-01-01');

    expect(records).toHaveLength(0);
  });

  it('skips records that fail schema validation without throwing', async () => {
    // A record missing Location entirely is invalid
    const badRecord = {
      ApplicationStatus: 'Lodged',
      LodgementDate: '2025-10-15',
      ApplicationType: 'DA',
      // Missing Location — required field
    };

    server.use(makeHandler(makePage([MINIMAL_RECORD, badRecord])));

    // Should not throw; bad record is skipped
    const records = await fetchRecentDAs('Some Council', '2025-01-01');

    // Only the valid MINIMAL_RECORD survives
    expect(records).toHaveLength(1);
    expect(records[0]!.ApplicationStatus).toBe('Lodged');
  });
});

// ---------------------------------------------------------------------------
// Tests: retry behaviour
// ---------------------------------------------------------------------------

describe('fetchRecentDAs — retry / error behaviour', () => {
  it('retries on 5xx and throws after exhausting retries', async () => {
    server.use(http.get(BASE, () => HttpResponse.json({ error: 'server error' }, { status: 503 })));

    await expect(fetchRecentDAs('Mosman Municipal Council', '2025-06-01')).rejects.toThrow();
  }, 30_000); // generous timeout — pRetry backoff

  it('does not retry on 400 (AbortError)', async () => {
    let hitCount = 0;

    server.use(
      http.get(BASE, () => {
        hitCount += 1;
        return HttpResponse.json({ error: 'bad request' }, { status: 400 });
      }),
    );

    await expect(fetchRecentDAs('Mosman Municipal Council', '2025-06-01')).rejects.toThrow();

    // AbortError means pRetry gives up immediately — only 1 hit
    expect(hitCount).toBe(1);
  });
});
