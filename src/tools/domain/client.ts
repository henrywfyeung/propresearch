// Domain API client — the single point of access (CLAUDE.md §8.1).
// Wraps fetch with pRetry (retries 429 + 5xx), Bearer auth, Zod validation,
// and per-report quota counting via AsyncLocalStorage ([R16]).

import { getReportCtx } from '@/agents/reportContext';
import { DomainQuotaError, SchemaDriftError } from '@/lib/errors';
import { logger } from '@/lib/observability/logger';
import pRetry, { AbortError } from 'p-retry';
import type { z } from 'zod';
import { getDomainAccessToken } from './auth';

const DOMAIN_BASE_URL = 'https://api.domain.com.au';
export const DOMAIN_CALLS_PER_REPORT = 50; // §11.2

export interface DomainCallOpts<T> {
  /** HTTP method; defaults to GET. */
  method?: 'GET' | 'POST';
  /** Query params (GET) or JSON body (POST). */
  params?: Record<string, unknown>;
  /** Zod schema the response must satisfy. */
  schema: z.ZodType<T>;
  /** In-process memo key — per-AsyncLocalStorage-context ONLY, never cross-request. */
  cacheKey?: string;
}

// In-process memo, scoped to a single report run via a WeakMap keyed on the
// context object. Never persists across requests (TOS, §4.3).
const memoByCtx = new WeakMap<object, Map<string, unknown>>();

function getMemo(): Map<string, unknown> | null {
  const ctx = getReportCtx();
  if (!ctx) return null;
  let m = memoByCtx.get(ctx);
  if (!m) {
    m = new Map();
    memoByCtx.set(ctx, m);
  }
  return m;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Call a Domain endpoint. `endpoint` is a path like `/v1/properties/{id}`.
 */
export async function domainCall<T>(endpoint: string, opts: DomainCallOpts<T>): Promise<T> {
  const { method = 'GET', params, schema, cacheKey } = opts;

  // In-process memo (per report context only).
  const memo = getMemo();
  if (cacheKey && memo?.has(cacheKey)) {
    return memo.get(cacheKey) as T;
  }

  // Per-report quota — increment + ceiling check ([R16] / §11.2).
  const ctx = getReportCtx();
  if (ctx) {
    ctx.domainCalls += 1;
    if (ctx.domainCalls > DOMAIN_CALLS_PER_REPORT) {
      throw new DomainQuotaError(
        `Exceeded ${DOMAIN_CALLS_PER_REPORT} Domain calls for report ${ctx.reportId}`,
      );
    }
  }

  // OAuth2 client-credentials bearer (cached ~12h) — see ./auth.ts.
  const accessToken = await getDomainAccessToken();

  const url = new URL(endpoint.startsWith('http') ? endpoint : `${DOMAIN_BASE_URL}${endpoint}`);
  let body: string | undefined;
  if (method === 'GET' && params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  } else if (method === 'POST' && params) {
    body = JSON.stringify(params);
  }

  const raw = await pRetry(
    async () => {
      const res = await fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
      });

      if (!res.ok) {
        if (RETRYABLE_STATUS.has(res.status)) {
          // throw a plain Error → pRetry will retry
          throw new Error(`Domain ${res.status} on ${endpoint}`);
        }
        // Non-retryable (4xx other than 429): abort immediately.
        throw new AbortError(`Domain ${res.status} on ${endpoint}`);
      }
      return (await res.json()) as unknown;
    },
    {
      retries: 4,
      minTimeout: 1000,
      maxTimeout: 10_000,
      factor: 2,
      onFailedAttempt: (e) => {
        logger.warn(
          { endpoint, attempt: e.attemptNumber, retriesLeft: e.retriesLeft },
          'domainCall retry',
        );
      },
    },
  );

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Schema drift — fires the §8.4 / §14.4 alert path.
    throw new SchemaDriftError(`Domain response failed validation on ${endpoint}`, {
      endpoint,
      issues: parsed.error.issues,
    });
  }

  if (cacheKey && memo) memo.set(cacheKey, parsed.data);
  return parsed.data;
}
