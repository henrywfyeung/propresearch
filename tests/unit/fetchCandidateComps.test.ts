import { fetchCandidateComps, normalizeStreet } from '@/agents/nodes/03_fetchCandidateComps';
// tests/unit/fetchCandidateComps.test.ts
import { runWithReportContext } from '@/agents/reportContext';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REA_HOST, graphState, listing, mockReaBlocked, mockReaOk } from '../fixtures/comps';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());
beforeEach(() => {
  process.env.RAPIDAPI_KEY = 'test-key';
  process.env.RAPIDAPI_REA_HOST = REA_HOST;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-30T00:00:00Z'));
});

describe('fetchCandidateComps', () => {
  it('returns ranked comparables on the happy path', async () => {
    mockReaOk(server, [
      listing('FAR', { beds: 5, lat: -33.86, lng: 151.2 }),
      listing('NEAR', { beds: 3, lat: -33.8201, lng: 151.2401 }),
    ]);
    const out = await runWithReportContext({ reportId: 'r1' }, () =>
      fetchCandidateComps(graphState()),
    );
    expect(out.comparables?.map((c) => c.id)).toEqual(['NEAR', 'FAR']);
    expect(out.errors).toBeUndefined();
  });

  it('degrades to an empty pool + PARTIAL_DATA error when REA is blocked', async () => {
    mockReaBlocked(server);
    const out = await runWithReportContext({ reportId: 'r2' }, () =>
      fetchCandidateComps(graphState()),
    );
    expect(out.comparables).toEqual([]);
    expect(out.errors?.[0]?.code).toBe('PARTIAL_DATA');
  });

  it('errors in-band when the subject is missing (no REA call)', async () => {
    const out = await runWithReportContext({ reportId: 'r3' }, () =>
      fetchCandidateComps(graphState({ subject: null })),
    );
    expect(out.errors?.[0]?.code).toBe('PARTIAL_DATA');
    expect(out.comparables).toBeUndefined();
  });

  it("drops the subject's own address from the comp pool", async () => {
    mockReaOk(server, [
      listing('SELF', { lat: -33.82, lng: 151.24 }),
      listing('OTHER', { lat: -33.8201, lng: 151.2401 }),
    ]);
    // listing('SELF') → address "SELF St, Mosman ..." ; match it as the subject.
    const out = await runWithReportContext({ reportId: 'r5' }, () =>
      fetchCandidateComps(graphState({ rawAddress: 'SELF St, Mosman NSW 2088' })),
    );
    expect(out.comparables?.map((c) => c.id)).toEqual(['OTHER']);
  });
});

describe('normalizeStreet (self-comp dedupe)', () => {
  it('canonicalises street-type suffixes so St == Street', () => {
    expect(normalizeStreet('29 York St, Richmond VIC 3121')).toBe(
      normalizeStreet('29 York Street, Richmond, VIC, 3121'),
    );
    expect(normalizeStreet('29 York Street, Richmond VIC 3121')).toBe('29 york st');
  });

  it('does NOT collapse different streets', () => {
    expect(normalizeStreet('29 York Street, Richmond')).not.toBe(
      normalizeStreet('31 York Street, Richmond'),
    );
    expect(normalizeStreet('29 York Street, Richmond')).not.toBe(
      normalizeStreet('29 Docker Street, Richmond'),
    );
  });
});
