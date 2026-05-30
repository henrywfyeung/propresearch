// tests/unit/rapidapi-client.test.ts
import { runWithReportContext } from '@/agents/reportContext';
import { RapidApiQuotaError, SchemaDriftError } from '@/lib/errors';
import { RAPIDAPI_CALLS_PER_REPORT, rapidApiCall } from '@/tools/rapidapi/client';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const OkSchema = z.object({ ok: z.literal(true) });
const HOST = 'realty-base-au.p.rapidapi.com';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  process.env.RAPIDAPI_KEY = 'test-key';
});

describe('rapidApiCall', () => {
  it('sends RapidAPI headers and returns a typed object', async () => {
    let sawKey: string | null = null;
    let sawHost: string | null = null;
    server.use(
      http.get(`https://${HOST}/ping`, ({ request }) => {
        sawKey = request.headers.get('x-rapidapi-key');
        sawHost = request.headers.get('x-rapidapi-host');
        return HttpResponse.json({ ok: true });
      }),
    );
    const out = await runWithReportContext({ reportId: 'r1' }, () =>
      rapidApiCall({ host: HOST, path: '/ping', schema: OkSchema }),
    );
    expect(out.ok).toBe(true);
    expect(sawKey).toBe('test-key');
    expect(sawHost).toBe(HOST);
  });

  it('appends params to the query string', async () => {
    let url = '';
    server.use(
      http.get(`https://${HOST}/search`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );
    await runWithReportContext({ reportId: 'r2' }, () =>
      rapidApiCall({ host: HOST, path: '/search', params: { q: 'Mosman', page: 2 }, schema: OkSchema }),
    );
    expect(url).toContain('q=Mosman');
    expect(url).toContain('page=2');
  });

  it(`throws RapidApiQuotaError on call ${RAPIDAPI_CALLS_PER_REPORT + 1}`, async () => {
    server.use(http.get(`https://${HOST}/ping`, () => HttpResponse.json({ ok: true })));
    await expect(
      runWithReportContext({ reportId: 'r3' }, async () => {
        for (let i = 0; i < RAPIDAPI_CALLS_PER_REPORT + 1; i++) {
          await rapidApiCall({ host: HOST, path: '/ping', schema: OkSchema });
        }
      }),
    ).rejects.toBeInstanceOf(RapidApiQuotaError);
  });

  it('retries a 503 then succeeds', async () => {
    let hits = 0;
    server.use(
      http.get(`https://${HOST}/flaky`, () => {
        hits += 1;
        return hits === 1 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({ ok: true });
      }),
    );
    const out = await runWithReportContext({ reportId: 'r4' }, () =>
      rapidApiCall({ host: HOST, path: '/flaky', schema: OkSchema }),
    );
    expect(out.ok).toBe(true);
    expect(hits).toBe(2);
  });

  it('does NOT retry a 404 (non-retryable)', async () => {
    let hits = 0;
    server.use(
      http.get(`https://${HOST}/missing`, () => {
        hits += 1;
        return new HttpResponse(null, { status: 404 });
      }),
    );
    await expect(
      runWithReportContext({ reportId: 'r5' }, () =>
        rapidApiCall({ host: HOST, path: '/missing', schema: OkSchema }),
      ),
    ).rejects.toThrow();
    expect(hits).toBe(1);
  });

  it('throws SchemaDriftError when the response fails Zod', async () => {
    server.use(http.get(`https://${HOST}/drift`, () => HttpResponse.json({ ok: 'nope' })));
    await expect(
      runWithReportContext({ reportId: 'r6' }, () =>
        rapidApiCall({ host: HOST, path: '/drift', schema: OkSchema }),
      ),
    ).rejects.toBeInstanceOf(SchemaDriftError);
  });
});
