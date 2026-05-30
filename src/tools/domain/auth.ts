// Domain OAuth2 Client Credentials token manager.
//
// Domain authenticates via the client-credentials grant, NOT a static bearer
// key (confirmed against developer.domain.com.au/docs/v2/authentication/oauth/
// client-credentials-grant). We exchange client_id:client_secret (basic auth)
// for a ~12h access_token, cache it in-process until just before expiry, and
// send it as the Bearer token on API calls.

import pRetry, { AbortError } from 'p-retry';
import { z } from 'zod';
import { logger } from '@/lib/observability/logger';

const TOKEN_ENDPOINT = 'https://auth.domain.com.au/v1/connect/token';

// Default scopes for the packages in §8.2. Override via DOMAIN_SCOPES.
// Exact per-endpoint scope names are confirmed in each endpoint's API
// reference; these are the documented read scopes plus the ones our
// wrappers need. Adjust once the project's approved packages are known.
const DEFAULT_SCOPES = [
  'api_listings_read',
  'api_agencies_read',
  'api_properties_read',
  'api_addresslocators_read',
  'api_suburbperformancestatistics_read',
  'api_salesresults_read',
  'api_propertyreports_read',
].join(' ');

const TokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  token_type: z.string().optional(),
});

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

let cached: CachedToken | null = null;
const SAFETY_MARGIN_MS = 60_000; // refresh 60s before actual expiry

/** Test hook: clear the cached token. */
export function __clearDomainTokenCache(): void {
  cached = null;
}

export async function getDomainAccessToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt - SAFETY_MARGIN_MS > now) {
    return cached.token;
  }

  const clientId = process.env.DOMAIN_CLIENT_ID;
  const clientSecret = process.env.DOMAIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('DOMAIN_CLIENT_ID / DOMAIN_CLIENT_SECRET are not set');
  }
  const scopes = process.env.DOMAIN_SCOPES ?? DEFAULT_SCOPES;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const raw = await pRetry(
    async () => {
      const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope: scopes }),
      });
      if (!res.ok) {
        // 400 invalid_scope etc. are not retryable, but transient 5xx are.
        if (res.status >= 500) throw new Error(`Domain token endpoint ${res.status}`);
        const text = await res.text();
        throw new AbortError(`Domain token endpoint ${res.status}: ${text}`);
      }
      return (await res.json()) as unknown;
    },
    { retries: 3, minTimeout: 500, factor: 2 },
  );

  const parsed = TokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('Domain token response failed validation');
  }

  cached = {
    token: parsed.data.access_token,
    expiresAt: now + parsed.data.expires_in * 1000,
  };
  logger.info({ expiresInS: parsed.data.expires_in }, 'Domain access token refreshed');
  return cached.token;
}
