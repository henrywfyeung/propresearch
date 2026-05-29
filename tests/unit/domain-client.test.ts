// Domain client unit tests (MSW). Covers quota ceiling, retry policy, and
// schema-drift detection from CLAUDE.md §8.1 / B1 acceptance criteria.

import { runWithReportContext } from '@/agents/reportContext';
import { DomainQuotaError, SchemaDriftError } from '@/lib/errors';
import { domainCall } from '@/tools/domain/client';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const OkSchema = z.object({ ok: z.literal(true) });
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  process.env.DOMAIN_API_KEY = 'test-key';
});

describe('domainCall', () => {
  it('returns a typed object on the happy path', async () => {
    server.use(
      http.get('https://api.domain.com.au/v1/ping', () => HttpResponse.json({ ok: true })),
    );
    const out = await runWithReportContext({ reportId: 'r1' }, () =>
      domainCall('/v1/ping', { schema: OkSchema }),
    );
    expect(out.ok).toBe(true);
  });

  it('throws DomainQuotaError on the 51st call within one report context', async () => {
    server.use(
      http.get('https://api.domain.com.au/v1/ping', () => HttpResponse.json({ ok: true })),
    );
    await expect(
      runWithReportContext({ reportId: 'r2' }, async () => {
        for (let i = 0; i < 50; i++) {
          await domainCall('/v1/ping', { schema: OkSchema });
        }
        // 51st
        await domainCall('/v1/ping', { schema: OkSchema });
      }),
    ).rejects.toBeInstanceOf(DomainQuotaError);
  });

  it('retries a 503 then succeeds', async () => {
    let hits = 0;
    server.use(
      http.get('https://api.domain.com.au/v1/flaky', () => {
        hits += 1;
        if (hits === 1) return new HttpResponse(null, { status: 503 });
        return HttpResponse.json({ ok: true });
      }),
    );
    const out = await runWithReportContext({ reportId: 'r3' }, () =>
      domainCall('/v1/flaky', { schema: OkSchema }),
    );
    expect(out.ok).toBe(true);
    expect(hits).toBe(2); // one retry
  });

  it('does NOT retry a 400 (non-retryable)', async () => {
    let hits = 0;
    server.use(
      http.get('https://api.domain.com.au/v1/bad', () => {
        hits += 1;
        return new HttpResponse(null, { status: 400 });
      }),
    );
    await expect(
      runWithReportContext({ reportId: 'r4' }, () => domainCall('/v1/bad', { schema: OkSchema })),
    ).rejects.toThrow();
    expect(hits).toBe(1); // aborted, no retry
  });

  it('throws SchemaDriftError when the response fails Zod', async () => {
    server.use(
      http.get('https://api.domain.com.au/v1/drift', () =>
        HttpResponse.json({ ok: 'not-a-boolean' }),
      ),
    );
    await expect(
      runWithReportContext({ reportId: 'r5' }, () => domainCall('/v1/drift', { schema: OkSchema })),
    ).rejects.toBeInstanceOf(SchemaDriftError);
  });

  it('memoises within a context when cacheKey is set', async () => {
    let hits = 0;
    server.use(
      http.get('https://api.domain.com.au/v1/memo', () => {
        hits += 1;
        return HttpResponse.json({ ok: true });
      }),
    );
    await runWithReportContext({ reportId: 'r6' }, async () => {
      await domainCall('/v1/memo', { schema: OkSchema, cacheKey: 'k' });
      await domainCall('/v1/memo', { schema: OkSchema, cacheKey: 'k' });
    });
    expect(hits).toBe(1);
  });
});
