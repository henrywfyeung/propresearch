// Domain OAuth2 client-credentials token manager (MSW). Verifies the token
// exchange, in-process caching, and refresh-after-expiry.

import { __clearDomainTokenCache, getDomainAccessToken } from '@/tools/domain/auth';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
  __clearDomainTokenCache();
});
afterAll(() => server.close());

beforeEach(() => {
  process.env.DOMAIN_CLIENT_ID = 'cid';
  process.env.DOMAIN_CLIENT_SECRET = 'secret';
  __clearDomainTokenCache();
});

describe('getDomainAccessToken', () => {
  it('exchanges client credentials for a bearer token', async () => {
    let body = '';
    server.use(
      http.post('https://auth.domain.com.au/v1/connect/token', async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({
          access_token: 'tok-1',
          expires_in: 43200,
          token_type: 'Bearer',
        });
      }),
    );
    const tok = await getDomainAccessToken();
    expect(tok).toBe('tok-1');
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('scope=');
  });

  it('caches the token across calls (one network hit)', async () => {
    let hits = 0;
    server.use(
      http.post('https://auth.domain.com.au/v1/connect/token', () => {
        hits += 1;
        return HttpResponse.json({ access_token: 'tok-cache', expires_in: 43200 });
      }),
    );
    await getDomainAccessToken();
    await getDomainAccessToken();
    await getDomainAccessToken();
    expect(hits).toBe(1);
  });

  it('refreshes after the token expires (minus safety margin)', async () => {
    vi.useFakeTimers();
    let hits = 0;
    server.use(
      http.post('https://auth.domain.com.au/v1/connect/token', () => {
        hits += 1;
        return HttpResponse.json({ access_token: `tok-${hits}`, expires_in: 120 });
      }),
    );
    const first = await getDomainAccessToken();
    expect(first).toBe('tok-1');
    // Advance past expiry (120s) + safety margin.
    vi.advanceTimersByTime(121_000);
    const second = await getDomainAccessToken();
    expect(second).toBe('tok-2');
    expect(hits).toBe(2);
  });

  it('throws when client credentials are missing', async () => {
    process.env.DOMAIN_CLIENT_ID = '';
    await expect(getDomainAccessToken()).rejects.toThrow(/DOMAIN_CLIENT_ID/);
  });
});
