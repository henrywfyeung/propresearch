// src/tools/nsw-planning/onlineDa.ts
// Client for the NSW ePlanning Online DA Data API (keyless/public).
//
// Non-obvious contract (live-probed 2026-06-01):
//   - `filters`, `PageNumber`, `PageSize` are HTTP HEADERS, not query params.
//     Query params → HTTP 400 "Required parameters … not met".
//   - `filters` header value is a JSON string:
//       {"filters":{"CouncilName":["<exact name>"],"LodgementDateFrom":"YYYY-MM-DD"}}
//   - Do NOT send `Ocp-Apim-Subscription-Key` (a dummy value → 400).
//   - Pagination: loop PageNumber 1..TotalPages with PageSize: 1000.
//   - Location coords are strings (X = lng, Y = lat) — parse to float.
//   - DevelopmentCategory is absent from real API responses; keep optional.
//
// Base URL overridable via NSW_ONLINEDA_BASE env for tests / MSW.

import { SchemaDriftError } from '@/lib/errors';
import { logger } from '@/lib/observability/logger';
import pRetry, { AbortError } from 'p-retry';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

function onlineDaBase(): string {
  return process.env.NSW_ONLINEDA_BASE ?? 'https://api.apps1.nsw.gov.au/eplanning/data/v0/OnlineDA';
}

// ---------------------------------------------------------------------------
// Retryable statuses
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// ---------------------------------------------------------------------------
// Per-record schema — strict-but-partial: only the fields we use.
// Extra fields in the response are stripped by .strip() (Zod default).
// ---------------------------------------------------------------------------

const DevelopmentTypeItemSchema = z.object({
  DevelopmentType: z.string(),
});

const LocationItemSchema = z.object({
  X: z.string(),
  Y: z.string(),
  FullAddress: z.string().optional(),
});

export const OnlineDaRecordSchema = z.object({
  ApplicationStatus: z.string(),
  LodgementDate: z.string(), // "YYYY-MM-DD"
  ApplicationType: z.string(),
  DevelopmentCategory: z.string().optional(),
  DevelopmentType: z.array(DevelopmentTypeItemSchema).optional(),
  CostOfDevelopment: z.number().optional(),
  PlanningPortalApplicationNumber: z.string().optional(),
  Location: z.array(LocationItemSchema),
});

export type OnlineDaRecord = z.infer<typeof OnlineDaRecordSchema>;

// ---------------------------------------------------------------------------
// Response envelope schema
// ---------------------------------------------------------------------------

const OnlineDaPageSchema = z.object({
  TotalPages: z.number(),
  TotalCount: z.number(),
  Application: z.array(z.unknown()),
});

// ---------------------------------------------------------------------------
// Core paginated fetch
// ---------------------------------------------------------------------------

async function fetchPage(
  url: string,
  filtersHeader: string,
  pageNumber: number,
): Promise<z.infer<typeof OnlineDaPageSchema>> {
  return pRetry(
    async () => {
      const res = await fetch(url, {
        headers: {
          filters: filtersHeader,
          PageNumber: String(pageNumber),
          PageSize: '1000',
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        if (RETRYABLE_STATUS.has(res.status)) {
          throw new Error(`OnlineDA HTTP ${res.status} on page ${pageNumber}`);
        }
        throw new AbortError(`OnlineDA non-retryable HTTP ${res.status} on page ${pageNumber}`);
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
          { url, pageNumber, attempt: e.attemptNumber, retriesLeft: e.retriesLeft },
          'onlineDa fetch retry',
        ),
    },
  ).then((raw) => {
    const parsed = OnlineDaPageSchema.safeParse(raw);
    if (!parsed.success) {
      throw new SchemaDriftError('OnlineDA page envelope failed validation', {
        issues: parsed.error.issues,
        pageNumber,
      });
    }
    return parsed.data;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch all DAs lodged at the given council on or after `lodgedFrom`.
 *
 * Paginates automatically (PageSize 1000, loops 1..TotalPages). Each
 * record is Zod-validated against the strict-but-partial `OnlineDaRecordSchema`;
 * records that fail schema validation are skipped with a warning (tolerate
 * API drift without aborting the whole fetch).
 *
 * @param councilName - Exact CouncilName string from the OnlineDA API
 *   (use `lgaToCouncil` to resolve from an LGA name).
 * @param lodgedFrom  - ISO date string "YYYY-MM-DD".
 * @returns All valid DA records across all pages.
 */
export async function fetchRecentDAs(
  councilName: string,
  lodgedFrom: string,
): Promise<OnlineDaRecord[]> {
  const url = onlineDaBase();
  const filtersHeader = JSON.stringify({
    filters: {
      CouncilName: [councilName],
      LodgementDateFrom: lodgedFrom,
    },
  });

  // Fetch page 1 to learn TotalPages
  const firstPage = await fetchPage(url, filtersHeader, 1);
  const { TotalPages } = firstPage;

  const allRaw: unknown[] = [...firstPage.Application];

  // Fetch remaining pages (if any) in sequence to avoid hammering the API
  for (let page = 2; page <= TotalPages; page++) {
    const next = await fetchPage(url, filtersHeader, page);
    allRaw.push(...next.Application);
  }

  // Validate each record; skip invalid ones with a warning
  const records: OnlineDaRecord[] = [];
  let skipped = 0;
  for (const raw of allRaw) {
    const parsed = OnlineDaRecordSchema.safeParse(raw);
    if (parsed.success) {
      records.push(parsed.data);
    } else {
      skipped += 1;
    }
  }

  if (skipped > 0) {
    logger.warn(
      { councilName, lodgedFrom, skipped, total: allRaw.length },
      'onlineDa: skipped records that failed schema validation',
    );
  }

  logger.debug(
    { councilName, lodgedFrom, total: records.length, pages: TotalPages },
    'onlineDa: fetched DAs',
  );

  return records;
}
