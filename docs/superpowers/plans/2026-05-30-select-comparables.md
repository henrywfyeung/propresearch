# selectComparables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `selectComparables` — Node 03's deterministic comp-selection logic: subject + location → top-30 scored candidate `Comparable[]`.

**Architecture:** A single pure async function in `src/tools/comps/`. It resolves a REA `locationId` (via `reaAutoComplete`, with a built fallback), fetches sold comps (`fetchReaSoldComparables`), scores each with the existing `similarityScore`, ranks descending, and caps at 30. No graph, no LLM, no NSW VG, no DB. Fair-value/anchor tiering is Node 06 (LLM) and is out of scope.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest 2.1 + MSW 2.6 (with `vi` fake `Date`), Biome. Path alias `@/` → `src/`.

**Reference spec:** `docs/superpowers/specs/2026-05-30-select-comparables-design.md`

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/tools/comps/selectComparables.ts` | `SelectCompsInput`/`SelectCompsOpts` types + `selectComparables()` | Create |
| `tests/unit/selectComparables.test.ts` | unit tests (MSW REA, faked `Date`) | Create |

**Reused (already in repo, do not modify):**
- `similarityScore(subject, candidate)` + `SimilaritySubject` — `src/tools/comps/similarity.ts`
- `fetchReaSoldComparables({ locationId, subject, withinDays })` — `src/tools/comps/reaComps.ts`
- `reaAutoComplete(query)` returning `{ locationId, type?, ... }[]` — `src/tools/rapidapi/rea.ts`
- `Comparable` — `src/schemas/state.ts`
- `runWithReportContext` — `src/agents/reportContext.ts`

---

## Task 1: `selectComparables`

**Files:**
- Create: `src/tools/comps/selectComparables.ts`
- Test: `tests/unit/selectComparables.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/selectComparables.test.ts
import { runWithReportContext } from '@/agents/reportContext';
import { selectComparables } from '@/tools/comps/selectComparables';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const HOST = 'realty-base-au.p.rapidapi.com';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());
beforeEach(() => {
  process.env.RAPIDAPI_KEY = 'test-key';
  process.env.RAPIDAPI_REA_HOST = HOST;
  // Pin Date only (keep setTimeout real so pRetry/MSW are unaffected).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-30T00:00:00Z'));
});

const SUBJECT = {
  subject: { beds: 3, baths: 2, landArea: 500, propertyType: 'House' },
  geo: { lat: -33.82, lng: 151.24 },
  location: { suburb: 'Mosman', state: 'NSW', postcode: '2088' },
};

interface ListingOpts {
  beds?: number;
  baths?: number;
  landArea?: number;
  propertyType?: string;
  price?: string;
  dateSold?: string;
  lat?: number;
  lng?: number;
}

function listing(id: string, o: ListingOpts) {
  return {
    listingId: id,
    propertyType: o.propertyType ?? 'house',
    price: { display: o.price ?? '$1,500,000' },
    dateSold: { value: o.dateSold ?? '2026-05-23' },
    landSize: { value: o.landArea ?? 500, unit: 'm2' },
    features: { general: { bedrooms: o.beds ?? 3, bathrooms: o.baths ?? 2, parkingSpaces: 1 } },
    address: {
      streetAddress: `${id} St`,
      suburb: 'Mosman',
      state: 'NSW',
      postcode: '2088',
      location: { latitude: o.lat ?? -33.82, longitude: o.lng ?? 151.24 },
    },
    images: [],
  };
}

const autoCompleteOk = {
  status: true,
  data: [{ locationId: 'suburb:Mosman, NSW 2088', type: 'suburb', display: { text: 'Mosman' } }],
};

function soldPage(listings: unknown[]) {
  return { totalResultCount: listings.length, currentPage: 1, data: listings };
}

function mockRea(o: { ac?: unknown; page1: unknown[]; capture?: (url: string) => void }) {
  server.use(
    http.get(`https://${HOST}/auto-complete`, () => HttpResponse.json(o.ac ?? autoCompleteOk)),
    http.get(`https://${HOST}/properties/search`, ({ request }) => {
      o.capture?.(request.url);
      const page = new URL(request.url).searchParams.get('page');
      return HttpResponse.json(soldPage(page === '1' ? o.page1 : []));
    }),
  );
}

describe('selectComparables', () => {
  it('ranks a near, same-bed comp above a far, bed-mismatched comp', async () => {
    mockRea({
      page1: [
        listing('FAR', { beds: 5, lat: -33.86, lng: 151.2 }),
        listing('NEAR', { beds: 3, lat: -33.8201, lng: 151.2401 }),
      ],
    });
    const out = await runWithReportContext({ reportId: 'r1' }, () => selectComparables(SUBJECT));
    expect(out.map((c) => c.id)).toEqual(['NEAR', 'FAR']);
    expect(out[0]?.similarityScore).toBeGreaterThan(out[1]?.similarityScore ?? 0);
  });

  it('caps at maxCandidates, keeping the highest scorers', async () => {
    const many = Array.from({ length: 40 }, (_, i) => listing(`L${i}`, { lat: -33.82 - i * 0.0006 }));
    mockRea({ page1: many });
    const out = await runWithReportContext({ reportId: 'r2' }, () =>
      selectComparables(SUBJECT, { maxCandidates: 30 }),
    );
    expect(out).toHaveLength(30);
    expect(out[0]?.id).toBe('L0');
  });

  it('populates similarityScore and keeps selection=candidate', async () => {
    mockRea({ page1: [listing('A', {})] });
    const out = await runWithReportContext({ reportId: 'r3' }, () => selectComparables(SUBJECT));
    expect(out[0]?.similarityScore).toBeGreaterThan(0);
    expect(out[0]?.selection).toBe('candidate');
  });

  it('falls back to a built locationId when auto-complete is empty', async () => {
    let searchUrl = '';
    mockRea({
      ac: { status: true, data: [] },
      page1: [listing('A', {})],
      capture: (u) => {
        searchUrl = u;
      },
    });
    await runWithReportContext({ reportId: 'r4' }, () => selectComparables(SUBJECT));
    expect(decodeURIComponent(searchUrl)).toContain('locationId=suburb:Mosman, NSW 2088');
  });

  it('returns an empty array when REA yields no comps', async () => {
    mockRea({ page1: [] });
    const out = await runWithReportContext({ reportId: 'r5' }, () => selectComparables(SUBJECT));
    expect(out).toEqual([]);
  });

  it('applies the recency deduction via the injected now', async () => {
    mockRea({
      page1: [
        listing('OLD', { dateSold: '2026-01-15' }),
        listing('NEW', { dateSold: '2026-05-23' }),
      ],
    });
    const out = await runWithReportContext({ reportId: 'r6' }, () =>
      selectComparables(SUBJECT, { now: new Date('2026-05-30T00:00:00Z') }),
    );
    expect(out.map((c) => c.id)).toEqual(['NEW', 'OLD']);
    expect(out[0]?.similarityScore).toBeGreaterThan(out[1]?.similarityScore ?? 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/selectComparables.test.ts`
Expected: FAIL — `Cannot find module '@/tools/comps/selectComparables'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/tools/comps/selectComparables.ts
// Node 03 core logic (CLAUDE.md §7.3): subject + location -> scored, ranked
// candidate comp pool (top N, selection='candidate'). Pure async function —
// no graph, no LLM, no NSW VG. Fair-value/anchor tiering is Node 06 (LLM).

import type { Comparable } from '@/schemas/state';
import { fetchReaSoldComparables } from '@/tools/comps/reaComps';
import { type SimilaritySubject, similarityScore } from '@/tools/comps/similarity';
import { reaAutoComplete } from '@/tools/rapidapi/rea';

export interface SelectCompsInput {
  /** Subject attributes in the canonical vocab ('House' triggers the land-area term). */
  subject: SimilaritySubject;
  /** Subject coordinates (from resolvedAddress) for distance scoring. */
  geo: { lat: number; lng: number };
  /** Used to resolve the REA locationId. */
  location: { suburb: string; state: string; postcode: string };
}

export interface SelectCompsOpts {
  /** Candidate-pool cap (§7.3). Default 30. */
  maxCandidates?: number;
  /** Sold-within window in days (§7.3). Default 180. */
  withinDays?: number;
  /** Injectable clock for deterministic recency in tests. Default new Date(). */
  now?: Date;
}

const MS_PER_WEEK = 7 * 86_400_000;

/**
 * Resolve a REA locationId for the suburb. Prefers reaAutoComplete's canonical
 * id; if it returns no matches, builds the observed `suburb:<Suburb>, <STATE> <PC>`
 * form. A thrown error (REA down / schema drift) propagates to the caller.
 */
async function resolveLocationId(location: SelectCompsInput['location']): Promise<string> {
  const fallback = `suburb:${location.suburb}, ${location.state} ${location.postcode}`;
  const locs = await reaAutoComplete(`${location.suburb} ${location.state}`);
  if (locs.length === 0) return fallback;
  const match = locs.find((l) => l.type === 'suburb') ?? locs[0];
  return match?.locationId ?? fallback;
}

/**
 * Node 03's deterministic comp selection: resolve the suburb, fetch recent sold
 * comps from REA, score each by similarity, rank descending (tie-break: nearer
 * first), and keep the top `maxCandidates`. Every entry stays `selection:
 * 'candidate'` — tiering is Node 06. Returns [] when REA yields no usable comps.
 */
export async function selectComparables(
  input: SelectCompsInput,
  opts: SelectCompsOpts = {},
): Promise<Comparable[]> {
  const { maxCandidates = 30, withinDays = 180, now = new Date() } = opts;

  const locationId = await resolveLocationId(input.location);
  const candidates = await fetchReaSoldComparables({
    locationId,
    subject: input.geo,
    withinDays,
  });

  const scored = candidates.map((c) => {
    const weeksSinceSale = Math.max(0, (now.getTime() - Date.parse(c.contractDate)) / MS_PER_WEEK);
    return {
      ...c,
      similarityScore: similarityScore(input.subject, {
        beds: c.beds,
        baths: c.baths,
        landArea: c.landArea,
        propertyType: c.propertyType,
        weeksSinceSale,
        distanceM: c.distanceM,
      }),
    };
  });

  scored.sort((a, b) => b.similarityScore - a.similarityScore || a.distanceM - b.distanceM);
  return scored.slice(0, maxCandidates);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/selectComparables.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Format, then run the full gate**

Biome must pass on the new files (the repo's `pnpm lint` runs `biome check src tests`). Format the two new files first so no formatting debt lands:

Run: `pnpm exec biome check --write src/tools/comps/selectComparables.ts tests/unit/selectComparables.test.ts`
Then run the full gate: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS (typecheck clean; `biome check` "No fixes applied" + cross-row clean; full suite green incl. the 6 new tests).

- [ ] **Step 6: Commit**

```bash
git add src/tools/comps/selectComparables.ts tests/unit/selectComparables.test.ts
git commit -m "feat: selectComparables (Node 03 scored candidate-comp pool)"
```

---

## Self-review (done while writing)

- **Spec coverage:** §2 contract → `SelectCompsInput`/`SelectCompsOpts`/`selectComparables` (Step 3). §3 flow steps 1–5 → `resolveLocationId` + fetch + score + sort/cap (Step 3). §4 error/degradation → throws propagate (no try/catch), empty→`[]` (test r5). §5 tests → all six cases (Step 1). §6 out-of-scope → nothing here touches graph/NSW-VG/tiering. §7 DoD → Step 5 gate + Step 6 single-file commit.
- **Placeholder scan:** none — full code in every step.
- **Type consistency:** `SimilaritySubject` (imported) used as `input.subject`; `similarityScore` candidate object matches `SimilarityCandidate` ({beds,baths,landArea,propertyType,weeksSinceSale,distanceM}); `fetchReaSoldComparables` opts `{locationId, subject: geo, withinDays}` match its signature; `Comparable.{contractDate,distanceM,similarityScore,selection}` used as defined in `state.ts`.

## Done criteria

- `selectComparables` implemented per spec §2–§4; pure (no graph/LLM/DB).
- 6 unit tests green; `pnpm typecheck && pnpm lint && pnpm test` all pass.
- Only `src/tools/comps/selectComparables.ts` + its test created; `CLAUDE.md` untouched.
