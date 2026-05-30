# REA Comp Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tools-layer that fetches recent sold comparables from the `realty-base-au` (realestate.com.au) RapidAPI proxy and normalizes them into the existing `ComparableSchema`, and retire the unused official-Domain OAuth client.

**Architecture:** A generic `rapidApiCall` transport (RapidAPI header auth + pRetry + Zod + per-report quota, mirroring `src/tools/domain/client.ts` and `src/tools/mapbox/geocode.ts`); a REA adapter that validates the auto-complete + sold-search responses; and a comp-assembly function that paginates sold results, normalizes each to a `Comparable`, computes Haversine distance from the subject, and filters to the last 180 days. Graph wiring (a future Node 03, incl. NSW VG price reconciliation + `similarityScore` ranking) consumes this tool and is **out of scope** here because the `src/agents/nodes/` layer does not exist yet.

**Tech Stack:** TypeScript (strict, ES2022), Zod 3.25, `p-retry` 6, Vitest 2.1 + MSW 2.6, Biome. Path alias `@/` → `src/`.

**Reference spec:** `docs/superpowers/specs/2026-05-30-rapidapi-comps-integration-design.md`

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/lib/geo.ts` | `haversineMeters` great-circle distance | Create |
| `src/lib/errors.ts` | add `RapidApiQuotaError` | Modify |
| `src/agents/reportContext.ts` | rename `domainCalls` → `rapidApiCalls` | Modify |
| `src/schemas/sources.ts` | `ProviderSchema`: drop `domain`/`domain+nsw-vg`, add `rea`/`rea+nsw-vg` | Modify |
| `src/tools/rapidapi/client.ts` | `rapidApiCall` transport (headers, retry, quota, schema-drift) | Create |
| `src/tools/rapidapi/rea.ts` | REA Zod schemas + `reaAutoComplete` + `reaSearchSold` | Create |
| `src/tools/comps/reaComps.ts` | `mapReaPropertyType`, `parseAudPrice`, `toComparable`, `fetchReaSoldComparables` | Create |
| `src/tools/domain/{client,auth}.ts` + their tests | legacy Domain OAuth client | **Remove** (after checkpoint commit) |
| `tests/unit/{geo,rapidapi-client,rea-adapter,reaComps}.test.ts` | unit tests | Create |
| `.env.example` | document `RAPIDAPI_KEY`, `RAPIDAPI_REA_HOST` | Create |
| `CLAUDE.md` | one-line pointer to the spec + REA decision | Modify (light) |

**Conventions to follow (verified in repo):**
- External tools read `process.env.X` directly (see `mapbox/geocode.ts`), no central env module.
- Schema-drift on any external response → throw `SchemaDriftError` (code `DOMAIN_SCHEMA_DRIFT`, reused generically — `mapbox/geocode.ts` already reuses it; it drives the §14.4 alert).
- Per-report counters live on `ReportCtx` via `getReportCtx()`; tests wrap calls in `runWithReportContext({ reportId }, fn)`.
- Run one test file: `pnpm vitest run <path>`. Typecheck: `pnpm typecheck`. Lint: `pnpm lint`.

---

## Task 1: Checkpoint & retire the legacy Domain OAuth client

The in-progress `src/tools/domain/{client,auth}.ts` (official-Domain OAuth) is unused by production code — only its two test files import it (`grep -rln "tools/domain" src tests` → only the tests). We commit it first so it stays recoverable in history (owner decision Q3), then remove it.

**Files:**
- Commit then remove: `src/tools/domain/client.ts`, `src/tools/domain/auth.ts`, `tests/unit/domain-client.test.ts`, `tests/unit/domain-auth.test.ts`

- [ ] **Step 1: Checkpoint the in-progress domain work (only those files; not `CLAUDE.md`)**

```bash
git add src/tools/domain/client.ts src/tools/domain/auth.ts \
        tests/unit/domain-client.test.ts tests/unit/domain-auth.test.ts
git commit -m "chore: checkpoint in-progress Domain OAuth client before retiring it

Superseded by the RapidAPI/REA comp source (see
docs/superpowers/specs/2026-05-30-rapidapi-comps-integration-design.md).
Committed so it remains recoverable in history."
```

- [ ] **Step 2: Remove the legacy client + its tests**

```bash
git rm src/tools/domain/client.ts src/tools/domain/auth.ts \
       tests/unit/domain-client.test.ts tests/unit/domain-auth.test.ts
```

- [ ] **Step 3: Verify nothing else references it**

Run: `grep -rn "tools/domain" src tests`
Expected: no output (empty).

- [ ] **Step 4: Typecheck + full test run stay green**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (no references to the removed files remain).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove unused Domain OAuth client (replaced by RapidAPI/REA)"
```

---

## Task 2: `haversineMeters` geo utility

Distance between two WGS84 points, in metres — needed for `Comparable.distanceM`.

**Files:**
- Create: `src/lib/geo.ts`
- Test: `tests/unit/geo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/geo.test.ts
import { haversineMeters } from '@/lib/geo';
import { describe, expect, it } from 'vitest';

describe('haversineMeters', () => {
  it('is 0 for identical points', () => {
    expect(haversineMeters({ lat: -33.8, lng: 151.2 }, { lat: -33.8, lng: 151.2 })).toBe(0);
  });

  it('matches a known Sydney distance within 1%', () => {
    // Sydney Opera House → Sydney Town Hall ≈ 1.86 km
    const d = haversineMeters({ lat: -33.8568, lng: 151.2153 }, { lat: -33.8731, lng: 151.2069 });
    expect(d).toBeGreaterThan(1840);
    expect(d).toBeLessThan(1880);
  });

  it('returns a rounded integer', () => {
    const d = haversineMeters({ lat: -33.81835, lng: 151.24536 }, { lat: -33.819, lng: 151.246 });
    expect(Number.isInteger(d)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/geo.test.ts`
Expected: FAIL — `Cannot find module '@/lib/geo'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/geo.ts
// Haversine great-circle distance in metres between two WGS84 points.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/geo.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo.ts tests/unit/geo.test.ts
git commit -m "feat: add haversineMeters geo utility"
```

---

## Task 3: Schema + errors + context plumbing

Swap the provider enum to REA, add the RapidAPI quota error, and rename the per-report counter (the only writer — the Domain client — was removed in Task 1).

**Files:**
- Modify: `src/schemas/sources.ts:8-19`
- Modify: `src/lib/errors.ts` (add after `DomainQuotaError`)
- Modify: `src/agents/reportContext.ts:7-24`
- Test: `tests/unit/rea-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/rea-provider.test.ts
import { ProviderSchema } from '@/schemas/sources';
import { describe, expect, it } from 'vitest';

describe('ProviderSchema', () => {
  it('accepts the REA providers', () => {
    expect(ProviderSchema.parse('rea')).toBe('rea');
    expect(ProviderSchema.parse('rea+nsw-vg')).toBe('rea+nsw-vg');
  });

  it('no longer accepts the retired Domain providers', () => {
    expect(ProviderSchema.safeParse('domain').success).toBe(false);
    expect(ProviderSchema.safeParse('domain+nsw-vg').success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/rea-provider.test.ts`
Expected: FAIL — `'rea'` rejected / `'domain'` still accepted.

- [ ] **Step 3a: Update `ProviderSchema`** in `src/schemas/sources.ts` — replace the enum (lines 8-19):

```ts
export const ProviderSchema = z.enum([
  'rea', // realestate.com.au via the realty-base-au RapidAPI proxy (comp source)
  'nsw-vg',
  'rea+nsw-vg', // merged comp: REA attrs/photos + NSW VG authoritative price (spec §5.4)
  'mapbox',
  'street-view',
  'nsw-planning',
  'council-da',
  'overlays',
  'derived',
  'llm',
]);
```

- [ ] **Step 3b: Add `RapidApiQuotaError`** in `src/lib/errors.ts`, immediately after the `DomainQuotaError` class:

```ts
/** Per-report RapidAPI call ceiling exceeded (spec §6). */
export class RapidApiQuotaError extends AppError {
  constructor(message = 'RapidAPI call ceiling reached for this report', details?: unknown) {
    super('RAPIDAPI_QUOTA_PER_REPORT', message, { details });
  }
}
```

- [ ] **Step 3c: Rename the counter** in `src/agents/reportContext.ts` — replace the interface + default (the comment header may keep its meaning, update the wording):

```ts
export interface ReportCtx {
  reportId: string;
  rapidApiCalls: number;
  costUsd: number;
}

export const reportCtx = new AsyncLocalStorage<ReportCtx>();

/** Run `fn` with a fresh per-report context. */
export function runWithReportContext<T>(
  init: { reportId: string; rapidApiCalls?: number; costUsd?: number },
  fn: () => Promise<T>,
): Promise<T> {
  return reportCtx.run(
    { reportId: init.reportId, rapidApiCalls: init.rapidApiCalls ?? 0, costUsd: init.costUsd ?? 0 },
    fn,
  );
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm vitest run tests/unit/rea-provider.test.ts && pnpm typecheck`
Expected: PASS, and typecheck clean (no remaining `domainCalls` references — verify with `grep -rn "domainCalls" src` → empty).

- [ ] **Step 5: Commit**

```bash
git add src/schemas/sources.ts src/lib/errors.ts src/agents/reportContext.ts tests/unit/rea-provider.test.ts
git commit -m "feat: REA providers + RapidApiQuotaError + rapidApiCalls counter"
```

---

## Task 4: `rapidApiCall` transport

Generic RapidAPI client: header auth, retry policy, per-report quota, schema-drift. Mirrors `src/tools/domain/client.ts` but uses `X-RapidAPI-Key`/`X-RapidAPI-Host` headers instead of OAuth.

**Files:**
- Create: `src/tools/rapidapi/client.ts`
- Test: `tests/unit/rapidapi-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/rapidapi-client.test.ts`
Expected: FAIL — `Cannot find module '@/tools/rapidapi/client'`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/rapidapi-client.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/rapidapi/client.ts tests/unit/rapidapi-client.test.ts
git commit -m "feat: rapidApiCall transport (header auth, retry, quota, schema-drift)"
```

---

## Task 5: REA adapter (auto-complete + sold search)

Zod schemas + functions for the two REA endpoints. The search envelope is validated leniently (`data` is an array of listing objects) and each listing is parsed against a strict-but-partial schema; unparseable items are dropped (the proxy is drift-prone, so one bad listing must not fail the whole fetch).

**Files:**
- Create: `src/tools/rapidapi/rea.ts`
- Create fixture: `tests/fixtures/rea-sold-page.json`
- Test: `tests/unit/rea-adapter.test.ts`

- [ ] **Step 1: Create the fixture** (real-shaped, trimmed from live data)

```json
// tests/fixtures/rea-sold-page.json
{
  "totalResultCount": 33114,
  "currentPage": 1,
  "resultsPerPage": 25,
  "status": true,
  "data": [
    {
      "listingId": 150833140,
      "propertyType": "apartment",
      "propertyTypeDisplay": "Apartment",
      "price": { "display": "$1,030,000" },
      "dateSold": { "display": "26 May 2026", "value": "2026-05-26" },
      "landSize": { "value": 787, "unit": "m2", "display": "787 m²" },
      "features": { "general": { "bedrooms": 1, "bathrooms": 1, "parkingSpaces": 1 } },
      "address": {
        "streetAddress": "12/22 Warringah Road",
        "suburb": "Mosman", "state": "NSW", "postcode": "2088",
        "location": { "latitude": -33.81835452, "longitude": 151.24535984 }
      },
      "mainImage": { "server": "https://i3.au.reastatic.net", "uri": "/main/image.jpg" },
      "images": [
        { "server": "https://i3.au.reastatic.net", "uri": "/a/image.jpg" },
        { "server": "https://i3.au.reastatic.net", "uri": "/b/image.jpg" }
      ]
    },
    {
      "listingId": 150999001,
      "propertyType": "house",
      "price": { "display": "Price Withheld" },
      "dateSold": { "display": "19 May 2026", "value": "2026-05-19" },
      "landSize": { "value": 0.12, "unit": "ha" },
      "features": { "general": { "bedrooms": 4, "bathrooms": 2, "parkingSpaces": 2 } },
      "address": {
        "streetAddress": "5 Example St", "suburb": "Mosman", "state": "NSW", "postcode": "2088",
        "location": { "latitude": -33.8200, "longitude": 151.2460 }
      },
      "images": []
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/rea-adapter.test.ts
import { runWithReportContext } from '@/agents/reportContext';
import { reaAutoComplete, reaSearchSold } from '@/tools/rapidapi/rea';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import soldPage from '../fixtures/rea-sold-page.json';

const HOST = 'realty-base-au.p.rapidapi.com';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  process.env.RAPIDAPI_KEY = 'test-key';
  process.env.RAPIDAPI_REA_HOST = HOST;
});

describe('reaAutoComplete', () => {
  it('returns location items with a locationId', async () => {
    server.use(
      http.get(`https://${HOST}/auto-complete`, () =>
        HttpResponse.json({
          status: true,
          data: [
            { locationId: 'suburb:Mosman, NSW 2088', type: 'suburb',
              display: { text: 'Mosman, NSW 2088', subtext: 'Suburb' },
              source: { name: 'Mosman', postcode: '2088', state: 'NSW' } },
          ],
        }),
      ),
    );
    const out = await runWithReportContext({ reportId: 'r1' }, () => reaAutoComplete('Mosman'));
    expect(out[0]?.locationId).toBe('suburb:Mosman, NSW 2088');
  });
});

describe('reaSearchSold', () => {
  it('parses the sold page into listing objects, keeping only dateSold items', async () => {
    server.use(http.get(`https://${HOST}/properties/search`, () => HttpResponse.json(soldPage)));
    const out = await runWithReportContext({ reportId: 'r2' }, () =>
      reaSearchSold('suburb:Mosman, NSW 2088', 1),
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.listingId).toBe('150833140');
    expect(out[0]?.dateSold?.value).toBe('2026-05-26');
    expect(out[0]?.address?.location?.latitude).toBeCloseTo(-33.8183, 3);
  });

  it('sends channel=sold and the page param', async () => {
    let url = '';
    server.use(
      http.get(`https://${HOST}/properties/search`, ({ request }) => {
        url = request.url;
        return HttpResponse.json(soldPage);
      }),
    );
    await runWithReportContext({ reportId: 'r3' }, () => reaSearchSold('suburb:Mosman, NSW 2088', 2));
    expect(url).toContain('channel=sold');
    expect(url).toContain('page=2');
    expect(url).toContain('locationId=suburb');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/rea-adapter.test.ts`
Expected: FAIL — `Cannot find module '@/tools/rapidapi/rea'`.

- [ ] **Step 4: Write the implementation**

```ts
// src/tools/rapidapi/rea.ts
// Adapter for the realty-base-au (realestate.com.au) RapidAPI proxy.
// Search-only: /auto-complete (location resolution) + /properties/search
// (channel=sold for comps). Spec §3-§4.

import { z } from 'zod';
import { rapidApiCall } from './client';

export const REA_HOST = process.env.RAPIDAPI_REA_HOST ?? 'realty-base-au.p.rapidapi.com';

// --- auto-complete ------------------------------------------------------
const ReaAutoCompleteItem = z.object({
  locationId: z.string(), // e.g. "suburb:Mosman, NSW 2088"
  type: z.string().optional(),
  display: z.object({ text: z.string(), subtext: z.string().optional() }).optional(),
  source: z
    .object({ name: z.string(), postcode: z.string().optional(), state: z.string().optional() })
    .optional(),
});
const ReaAutoCompleteResponse = z.object({
  data: z.array(ReaAutoCompleteItem),
  status: z.boolean().optional(),
});

export type ReaLocation = z.infer<typeof ReaAutoCompleteItem>;

export async function reaAutoComplete(query: string): Promise<ReaLocation[]> {
  const res = await rapidApiCall({
    host: REA_HOST,
    path: '/auto-complete',
    params: { query },
    schema: ReaAutoCompleteResponse,
  });
  return res.data;
}

// --- sold search --------------------------------------------------------
// Strict-but-partial: only the fields the comp normalizer needs. Extra fields
// are ignored. A listing without dateSold is not a usable sold comp.
export const ReaSoldListingSchema = z.object({
  listingId: z.union([z.string(), z.number()]).transform(String),
  propertyType: z.string().nullish(),
  price: z.object({ display: z.string().optional() }).nullish(),
  dateSold: z.object({ value: z.string().optional(), display: z.string().optional() }).nullish(),
  landSize: z.object({ value: z.number().optional(), unit: z.string().optional() }).nullish(),
  features: z
    .object({
      general: z
        .object({
          bedrooms: z.number().optional(),
          bathrooms: z.number().optional(),
          parkingSpaces: z.number().optional(),
        })
        .partial()
        .optional(),
    })
    .nullish(),
  address: z
    .object({
      streetAddress: z.string().optional(),
      suburb: z.string().optional(),
      state: z.string().optional(),
      postcode: z.string().optional(),
      location: z.object({ latitude: z.number(), longitude: z.number() }).nullish(),
    })
    .nullish(),
  images: z.array(z.object({ server: z.string(), uri: z.string() })).nullish(),
  mainImage: z.object({ server: z.string(), uri: z.string() }).nullish(),
});
export type ReaSoldListing = z.infer<typeof ReaSoldListingSchema>;

// Lenient envelope — the listing array is validated per-item below.
const ReaSearchResponse = z.object({
  totalResultCount: z.number().optional(),
  currentPage: z.number().optional(),
  data: z.array(z.unknown()),
});

export async function reaSearchSold(locationId: string, page = 1): Promise<ReaSoldListing[]> {
  const res = await rapidApiCall({
    host: REA_HOST,
    path: '/properties/search',
    params: { locationId, channel: 'sold', page },
    schema: ReaSearchResponse,
  });

  const out: ReaSoldListing[] = [];
  for (const item of res.data) {
    const parsed = ReaSoldListingSchema.safeParse(item);
    if (parsed.success && parsed.data.dateSold) out.push(parsed.data);
  }
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/rea-adapter.test.ts`
Expected: PASS (3 tests).

> If TS complains about importing JSON, this repo targets ES2022 with bundler
> resolution; Vitest imports JSON natively. If `pnpm typecheck` errors on the
> JSON import, add `"resolveJsonModule": true` to `tsconfig.json` `compilerOptions`
> and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/tools/rapidapi/rea.ts tests/fixtures/rea-sold-page.json tests/unit/rea-adapter.test.ts
git commit -m "feat: REA adapter (auto-complete + sold search)"
```

---

## Task 6: REA → `Comparable` normalizer

Pure transforms (`mapReaPropertyType`, `parseAudPrice`) + `toComparable` (builds a valid `Comparable`, or returns `null` when the listing is unusable as a comp — no clean price, no sold date, or no geo).

**Files:**
- Create: `src/tools/comps/reaComps.ts` (normalizer functions only in this task; the orchestrator is Task 7)
- Test: `tests/unit/reaComps.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/reaComps.test.ts
import { ComparableSchema } from '@/schemas/state';
import { mapReaPropertyType, parseAudPrice, toComparable } from '@/tools/comps/reaComps';
import type { ReaSoldListing } from '@/tools/rapidapi/rea';
import { describe, expect, it } from 'vitest';

const SUBJECT = { lat: -33.8184, lng: 151.2454 };

const base: ReaSoldListing = {
  listingId: '150833140',
  propertyType: 'apartment',
  price: { display: '$1,030,000' },
  dateSold: { display: '26 May 2026', value: '2026-05-26' },
  landSize: { value: 787, unit: 'm2' },
  features: { general: { bedrooms: 1, bathrooms: 1, parkingSpaces: 1 } },
  address: {
    streetAddress: '12/22 Warringah Road', suburb: 'Mosman', state: 'NSW', postcode: '2088',
    location: { latitude: -33.81835452, longitude: 151.24535984 },
  },
  images: [
    { server: 'https://i3.au.reastatic.net', uri: '/a/image.jpg' },
    { server: 'https://i3.au.reastatic.net', uri: '/b/image.jpg' },
  ],
};

describe('mapReaPropertyType', () => {
  it('maps to the canonical vocab used by similarity scoring', () => {
    expect(mapReaPropertyType('house')).toBe('House');
    expect(mapReaPropertyType('apartment')).toBe('ApartmentUnitFlat');
    expect(mapReaPropertyType('townhouse')).toBe('Townhouse');
    expect(mapReaPropertyType('something-weird')).toBe('Other');
    expect(mapReaPropertyType(null)).toBe('Other');
  });
});

describe('parseAudPrice', () => {
  it('parses a clean dollar amount', () => {
    expect(parseAudPrice('$1,030,000')).toBe(1030000);
  });
  it('returns null for withheld / non-numeric', () => {
    expect(parseAudPrice('Price Withheld')).toBeNull();
    expect(parseAudPrice('Contact Agent')).toBeNull();
    expect(parseAudPrice(undefined)).toBeNull();
  });
});

describe('toComparable', () => {
  it('produces a schema-valid Comparable', () => {
    const c = toComparable(base, SUBJECT);
    expect(c).not.toBeNull();
    expect(() => ComparableSchema.parse(c)).not.toThrow();
    expect(c?.salePrice).toBe(1030000);
    expect(c?.contractDate).toBe('2026-05-26');
    expect(c?.propertyType).toBe('ApartmentUnitFlat');
    expect(c?.beds).toBe(1);
    expect(c?.landArea).toBe(787);
    expect(c?.photos).toEqual([
      'https://i3.au.reastatic.net/a/image.jpg',
      'https://i3.au.reastatic.net/b/image.jpg',
    ]);
    expect(c?.distanceM).toBeLessThan(50); // same location
    expect(c?.source.provider).toBe('rea');
  });

  it('converts hectares to m²', () => {
    const c = toComparable({ ...base, landSize: { value: 0.12, unit: 'ha' } }, SUBJECT);
    expect(c?.landArea).toBe(1200);
  });

  it('returns null when the price is withheld', () => {
    expect(toComparable({ ...base, price: { display: 'Price Withheld' } }, SUBJECT)).toBeNull();
  });

  it('returns null when geo is missing', () => {
    expect(toComparable({ ...base, address: { streetAddress: '1 X St' } }, SUBJECT)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/reaComps.test.ts`
Expected: FAIL — `Cannot find module '@/tools/comps/reaComps'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/tools/comps/reaComps.ts
// REA → Comparable normalization + sold-comp assembly. Spec §4-§5.

import { haversineMeters, type LatLng } from '@/lib/geo';
import type { Comparable } from '@/schemas/state';
import type { SourceRef } from '@/schemas/sources';
import { reaSearchSold, type ReaSoldListing } from '@/tools/rapidapi/rea';

// REA propertyType vocab → the canonical vocab similarity scoring expects.
// 'House' is load-bearing: similarityScore only applies the land-area term for
// subject.propertyType === 'House' (src/tools/comps/similarity.ts).
const PROPERTY_TYPE_MAP: Record<string, string> = {
  house: 'House',
  acreage: 'House',
  acreagesemirural: 'House',
  apartment: 'ApartmentUnitFlat',
  unit: 'ApartmentUnitFlat',
  flat: 'ApartmentUnitFlat',
  unitapartment: 'ApartmentUnitFlat',
  townhouse: 'Townhouse',
  villa: 'Villa',
  duplex: 'Townhouse',
  land: 'Land',
  residentialland: 'Land',
};

export function mapReaPropertyType(raw: string | null | undefined): string {
  if (!raw) return 'Other';
  return PROPERTY_TYPE_MAP[raw.toLowerCase().replace(/[^a-z]/g, '')] ?? 'Other';
}

/** Parse a single clean AUD amount; null for ranges / words / withheld. */
export function parseAudPrice(display: string | null | undefined): number | null {
  if (!display) return null;
  const m = display.match(/^\s*\$?\s*([\d,]+)\s*$/) ?? display.match(/\$\s?([\d,]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function landToM2(landSize: ReaSoldListing['landSize']): number | null {
  if (!landSize?.value) return null;
  const u = (landSize.unit ?? 'm2').toLowerCase();
  if (u === 'ha' || u.startsWith('hectare')) return Math.round(landSize.value * 10_000);
  return landSize.value; // m2 / sqm
}

function photoUrls(l: ReaSoldListing, cap = 8): string[] {
  return (l.images ?? []).map((i) => `${i.server}${i.uri}`).slice(0, cap);
}

/**
 * Normalize one REA sold listing into a candidate Comparable, or null if it
 * can't serve as a comp (no clean price, no sold date, or no geo). Ranking
 * (similarityScore/selection) is left to the future Node 03.
 */
export function toComparable(l: ReaSoldListing, subject: LatLng): Comparable | null {
  const salePrice = parseAudPrice(l.price?.display);
  const contractDate = l.dateSold?.value ?? null;
  const loc = l.address?.location;
  if (salePrice == null || !contractDate || !loc) return null;

  const g = l.features?.general ?? {};
  const a = l.address ?? {};
  const address = [a.streetAddress, a.suburb, a.state, a.postcode].filter(Boolean).join(', ');

  const source: SourceRef = {
    provider: 'rea',
    endpoint: '/properties/search?channel=sold',
    fetchedAt: new Date().toISOString(),
    // Placeholder index; the consuming node fixes the index when it places the
    // comp into state (the critic resolves final claim paths at compose time).
    path: '/comparables/0/salePrice',
  };

  return {
    id: l.listingId,
    address,
    salePrice,
    contractDate,
    distanceM: haversineMeters(subject, { lat: loc.latitude, lng: loc.longitude }),
    beds: g.bedrooms ?? 0,
    baths: g.bathrooms ?? 0,
    landArea: landToM2(l.landSize),
    propertyType: mapReaPropertyType(l.propertyType),
    photos: photoUrls(l),
    visionAnalysis: null,
    similarityScore: 0,
    selection: 'candidate',
    adjustments: [],
    adjustedValue: null,
    adjustmentNarrative: null,
    source,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/reaComps.test.ts`
Expected: PASS (mapReaPropertyType, parseAudPrice, toComparable — 8 assertions across 6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/comps/reaComps.ts tests/unit/reaComps.test.ts
git commit -m "feat: REA->Comparable normalizer (price/date/land/type/geo)"
```

---

## Task 7: Sold-comp assembly (`fetchReaSoldComparables`)

Paginate the sold channel, normalize, drop unusable, filter to the last 180 days, dedupe by listing id. This is the function a future Node 03 calls.

**Files:**
- Modify: `src/tools/comps/reaComps.ts` (append the orchestrator + its types)
- Test: `tests/unit/reaComps-fetch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/reaComps-fetch.test.ts
import { runWithReportContext } from '@/agents/reportContext';
import { fetchReaSoldComparables } from '@/tools/comps/reaComps';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const HOST = 'realty-base-au.p.rapidapi.com';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  process.env.RAPIDAPI_KEY = 'test-key';
  process.env.RAPIDAPI_REA_HOST = HOST;
});

const listing = (id: string, value: string, dateSold: string) => ({
  listingId: id,
  propertyType: 'apartment',
  price: { display: value },
  dateSold: { value: dateSold },
  features: { general: { bedrooms: 2, bathrooms: 1, parkingSpaces: 1 } },
  address: {
    streetAddress: `${id} St`, suburb: 'Mosman', state: 'NSW', postcode: '2088',
    location: { latitude: -33.82, longitude: 151.24 },
  },
  images: [],
});

describe('fetchReaSoldComparables', () => {
  it('keeps recent priced comps, drops withheld + stale, dedupes by id', async () => {
    const recent = new Date().toISOString().slice(0, 10);
    server.use(
      http.get(`https://${HOST}/properties/search`, ({ request }) => {
        const page = new URL(request.url).searchParams.get('page');
        if (page === '1') {
          return HttpResponse.json({
            totalResultCount: 4, currentPage: 1,
            data: [
              listing('A', '$1,000,000', recent),        // keep
              listing('B', 'Price Withheld', recent),    // drop (no price)
              listing('C', '$900,000', '2019-01-01'),    // drop (stale)
              listing('A', '$1,000,000', recent),        // dup of A
            ],
          });
        }
        return HttpResponse.json({ totalResultCount: 4, currentPage: 2, data: [] });
      }),
    );

    const comps = await runWithReportContext({ reportId: 'r1' }, () =>
      fetchReaSoldComparables({ locationId: 'suburb:Mosman, NSW 2088', subject: { lat: -33.82, lng: 151.24 } }),
    );

    expect(comps.map((c) => c.id)).toEqual(['A']);
    expect(comps[0]?.salePrice).toBe(1000000);
  });

  it('stops paginating at an empty page', async () => {
    let calls = 0;
    server.use(
      http.get(`https://${HOST}/properties/search`, () => {
        calls += 1;
        return HttpResponse.json({ data: [] });
      }),
    );
    await runWithReportContext({ reportId: 'r2' }, () =>
      fetchReaSoldComparables({ locationId: 'suburb:Mosman, NSW 2088', subject: { lat: -33.82, lng: 151.24 }, maxPages: 3 }),
    );
    expect(calls).toBe(1); // first page empty → stop
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/reaComps-fetch.test.ts`
Expected: FAIL — `fetchReaSoldComparables` is not exported.

- [ ] **Step 3: Append the orchestrator to `src/tools/comps/reaComps.ts`**

```ts
// --- sold-comp assembly -------------------------------------------------

export interface FetchReaCompsOpts {
  /** REA locationId, e.g. 'suburb:Mosman, NSW 2088' (from reaAutoComplete). */
  locationId: string;
  /** Subject coordinates (from resolvedAddress) for distance scoring. */
  subject: LatLng;
  /** Sold-within window in days (default 180, per §7.3). */
  withinDays?: number;
  /** Max sold pages to fetch (default 3 → ~75 candidates). */
  maxPages?: number;
}

/**
 * Fetch recent sold comparables for a suburb: paginate the REA sold channel,
 * normalize, drop unusable, filter to `withinDays`, dedupe by id. Returns
 * candidate Comparables (unranked); Node 03 applies similarityScore + selection.
 */
export async function fetchReaSoldComparables(opts: FetchReaCompsOpts): Promise<Comparable[]> {
  const { locationId, subject, withinDays = 180, maxPages = 3 } = opts;
  const cutoff = Date.now() - withinDays * 86_400_000;
  const byId = new Map<string, Comparable>();

  for (let page = 1; page <= maxPages; page++) {
    const listings = await reaSearchSold(locationId, page);
    if (listings.length === 0) break;
    for (const l of listings) {
      const c = toComparable(l, subject);
      if (!c) continue;
      if (new Date(c.contractDate).getTime() < cutoff) continue;
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
  }
  return Array.from(byId.values());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/reaComps-fetch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole suite + typecheck + lint**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS across the board.

- [ ] **Step 6: Commit**

```bash
git add src/tools/comps/reaComps.ts tests/unit/reaComps-fetch.test.ts
git commit -m "feat: fetchReaSoldComparables (paginate + 180d filter + dedupe)"
```

---

## Task 8: Env example + docs pointer

Record the new env vars and point CLAUDE.md at the spec. Keep the CLAUDE.md edit **light** — there are uncommitted CLAUDE.md changes from the owner, so add a small pointer rather than rewriting sections (deeper supersession can fold into the owner's edits).

**Files:**
- Create: `.env.example`
- Modify: `CLAUDE.md` (add one pointer line near §4.3 / §8)

- [ ] **Step 1: Create `.env.example`**

```bash
# RapidAPI — REA comp source (spec docs/superpowers/specs/2026-05-30-rapidapi-comps-integration-design.md)
# Personal-use only; data is scraped portal content (accepted risk, spec §2).
RAPIDAPI_KEY=
RAPIDAPI_REA_HOST=realty-base-au.p.rapidapi.com

# Other runtime keys read by the tools layer (see CLAUDE.md §16.1 for the full list):
MAPBOX_TOKEN=
GOOGLE_MAPS_KEY=
```

- [ ] **Step 2: Add a pointer in `CLAUDE.md`**

Find the §4.3 line that begins "What we use instead" and add, as a new sentence at the end of that paragraph:

```
> **Comp source (2026-05): REA via the `realty-base-au` RapidAPI proxy.** NSW VG
> stays the authoritative NSW price cross-check + open-data fallback; `domain-au`
> was evaluated and dropped (cannot deliver recent comps — unsorted, ~35% prices
> withheld). Accepted personal-use risk + full design in
> `docs/superpowers/specs/2026-05-30-rapidapi-comps-integration-design.md`.
```

- [ ] **Step 3: Verify nothing broke**

Run: `pnpm lint`
Expected: PASS (Biome ignores `.env.example` and `.md`).

- [ ] **Step 4: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: env example + CLAUDE.md pointer for the REA comp source"
```

---

## Done criteria (maps to spec §10)

- `src/tools/rapidapi/` (transport + REA adapter) and `src/tools/comps/reaComps.ts` exist, fully unit-tested incl. withheld-price→null, hectare→m², Haversine distance, schema-valid `Comparable`.
- `ProviderSchema` carries `rea`/`rea+nsw-vg`; `domainCalls` renamed; `RapidApiQuotaError` added.
- Legacy Domain OAuth client committed (recoverable) then removed; `grep -rn "tools/domain" src tests` empty.
- `pnpm typecheck && pnpm lint && pnpm test` green.
- `.env.example` + CLAUDE.md pointer landed.

## Deferred to a future plan (NOT in scope here)

- Graph **Node 03** wiring (the `src/agents/nodes/` layer doesn't exist yet): call `reaAutoComplete` → `fetchReaSoldComparables` → **NSW VG price reconciliation** (`rea+nsw-vg`, NSW only) → `similarityScore` ranking → top-30 selection.
- Node 04b comp-vision activation (now unblocked — comps carry `photos`).
- VIC handling specifics (REA stands alone; VPSR median context).
- `domain-au` for-sale/subject use; rentals; market context (spec §8).
