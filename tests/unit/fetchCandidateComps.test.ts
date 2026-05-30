import { fetchCandidateComps } from '@/agents/nodes/03_fetchCandidateComps';
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
});
