// src/tools/rapidapi/client.ts
// Generic RapidAPI transport — single point of access for RapidAPI-hosted
// sources. Header auth (X-RapidAPI-Key/Host), pRetry on 429/5xx, Zod validation
// (→ SchemaDriftError), and per-report call quota via AsyncLocalStorage.
// Mirrors src/tools/mapbox/geocode.ts + the retired Domain client.

import { getReportCtx } from '@/agents/reportContext';
import { RapidApiQuotaError, SchemaDriftError } from '@/lib/errors';
import { logger } from '@/lib/observability/logger';
import pRetry, { AbortError } from 'p-retry';
import type { z } from 'zod';

export const RAPIDAPI_CALLS_PER_REPORT = 30; // spec §6 (real usage ~4)
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface RapidApiCallOpts<T> {
  /** RapidAPI host, e.g. 'realty-base-au.p.rapidapi.com'. */
  host: string;
  /** Path, e.g. '/properties/search'. */
  path: string;
  /** Query params (strings/numbers); undefined values are skipped. */
  params?: Record<string, string | number | undefined>;
  /** Zod schema the response must satisfy. */
  schema: z.ZodType<T>;
}

export async function rapidApiCall<T>(opts: RapidApiCallOpts<T>): Promise<T> {
  const { host, path, params, schema } = opts;

  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error('RAPIDAPI_KEY is not set');

  // Per-report quota (spec §6).
  const ctx = getReportCtx();
  if (ctx) {
    ctx.rapidApiCalls += 1;
    if (ctx.rapidApiCalls > RAPIDAPI_CALLS_PER_REPORT) {
      throw new RapidApiQuotaError(
        `Exceeded ${RAPIDAPI_CALLS_PER_REPORT} RapidAPI calls for report ${ctx.reportId}`,
      );
    }
  }

  const url = new URL(path.startsWith('http') ? path : `https://${host}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const raw = await pRetry(
    async () => {
      const res = await fetch(url.toString(), {
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host, Accept: 'application/json' },
      });
      if (!res.ok) {
        if (RETRYABLE_STATUS.has(res.status)) {
          throw new Error(`RapidAPI ${res.status} on ${host}${url.pathname}`);
        }
        throw new AbortError(`RapidAPI ${res.status} on ${host}${url.pathname}`);
      }
      return (await res.json()) as unknown;
    },
    {
      retries: 4,
      minTimeout: 1000,
      maxTimeout: 10_000,
      factor: 2,
      onFailedAttempt: (e) =>
        logger.warn(
          { host, path, attempt: e.attemptNumber, retriesLeft: e.retriesLeft },
          'rapidApiCall retry',
        ),
    },
  );

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new SchemaDriftError(`RapidAPI response failed validation on ${host}${url.pathname}`, {
      host,
      path,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}
