# Graph Framework + Node 03 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the LangGraph runtime (minimal `Annotation.Root` state + `StateGraph`) and run `selectComparables` as the first real node (`fetchCandidateComps`).

**Architecture:** A 5-channel `Annotation.Root` reusing the existing `mergeByKey`/`appendReducer` reducers; a `fetchCandidateComps` node that reads seeded `resolvedAddress`+`subject`, calls `selectComparables`, and degrades in-band on failure; a one-node `StateGraph` (`START → fetchCandidateComps → END`) compiled in-memory (no checkpointer), invoked through `runGraph` which establishes the per-report context. Subject/address are graph inputs (Nodes 01/02 deferred).

**Tech Stack:** `@langchain/langgraph@0.2.34`, TypeScript (strict, `noUncheckedIndexedAccess`), Vitest 2.1 + MSW 2.6 (faked `Date`), Biome. Path alias `@/` → `src/`.

**Reference spec:** `docs/superpowers/specs/2026-05-30-graph-framework-node03-design.md`

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/agents/state.ts` | loosen `mergeByKey` generic (`Record<string,unknown>` → `object`) | Modify |
| `src/agents/annotation.ts` | `GraphAnnotation` (5 channels) + `GraphState` type | Create |
| `src/agents/nodes/03_fetchCandidateComps.ts` | Node 03 node fn | Create |
| `src/agents/graph.ts` | `StateGraph` wiring + `runGraph` | Create |
| `tests/fixtures/comps.ts` | shared REA MSW mocks + `sampleSubject`/`sampleResolvedAddress`/`graphState` | Create |
| `tests/unit/fetchCandidateComps.test.ts` | node unit tests | Create |
| `tests/unit/graph.test.ts` | graph integration tests | Create |

**Reuses:** `selectComparables` (`@/tools/comps/selectComparables`), `runWithReportContext` (`@/agents/reportContext`), `logger` (`@/lib/observability/logger`), `ResolvedAddress`/`SubjectProperty`/`Comparable` (`@/schemas/state`).

---

## Task 1: State channels + Node 03 (unit-tested)

**Files:**
- Modify: `src/agents/state.ts` (the `mergeByKey` signature only)
- Create: `src/agents/annotation.ts`
- Create: `src/agents/nodes/03_fetchCandidateComps.ts`
- Create: `tests/fixtures/comps.ts`
- Test: `tests/unit/fetchCandidateComps.test.ts`

- [ ] **Step 1: Create the shared test fixtures**

```ts
// tests/fixtures/comps.ts — shared REA MSW mocks + graph-state fixtures.
import type { GraphState } from '@/agents/annotation';
import type { ResolvedAddress, SubjectProperty } from '@/schemas/state';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

type Server = ReturnType<typeof setupServer>;

export const REA_HOST = 'realty-base-au.p.rapidapi.com';

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

export function listing(id: string, o: ListingOpts = {}) {
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

/** Auto-complete OK + a single page of sold listings. */
export function mockReaOk(server: Server, page1: unknown[]) {
  server.use(
    http.get(`https://${REA_HOST}/auto-complete`, () => HttpResponse.json(autoCompleteOk)),
    http.get(`https://${REA_HOST}/properties/search`, ({ request }) => {
      const page = new URL(request.url).searchParams.get('page');
      return HttpResponse.json(soldPage(page === '1' ? page1 : []));
    }),
  );
}

/** Auto-complete OK, but the sold search is blocked (403 — non-retryable, fast). */
export function mockReaBlocked(server: Server) {
  server.use(
    http.get(`https://${REA_HOST}/auto-complete`, () => HttpResponse.json(autoCompleteOk)),
    http.get(`https://${REA_HOST}/properties/search`, () => new HttpResponse(null, { status: 403 })),
  );
}

export const sampleResolvedAddress: ResolvedAddress = {
  domainPropertyId: 'p1',
  lat: -33.82,
  lng: 151.24,
  suburb: 'Mosman',
  postcode: '2088',
  state: 'NSW',
  normalizedAddress: '1 Example St, Mosman NSW 2088',
};

export const sampleSubject: SubjectProperty = {
  attrs: { beds: 3, baths: 2, parking: 1, landArea: 500, buildingArea: null, propertyType: 'House' },
  photos: [],
  listing: null,
  visionAnalysis: null,
  streetView: null,
  domainAvm: {
    low: 0,
    mid: 0,
    high: 0,
    confidence: 'low',
    source: { provider: 'derived', endpoint: 'seed', fetchedAt: '2026-05-30T00:00:00.000Z', path: '/subject' },
  },
};

/** Build a full GraphState, overriding any channel. */
export function graphState(over: Partial<GraphState> = {}): GraphState {
  return {
    reportId: 'r1',
    resolvedAddress: sampleResolvedAddress,
    subject: sampleSubject,
    comparables: [],
    errors: [],
    ...over,
  };
}
```

- [ ] **Step 2: Write the node unit test**

```ts
// tests/unit/fetchCandidateComps.test.ts
import { runWithReportContext } from '@/agents/reportContext';
import { fetchCandidateComps } from '@/agents/nodes/03_fetchCandidateComps';
import { REA_HOST, graphState, listing, mockReaBlocked, mockReaOk } from '../fixtures/comps';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
    const out = await runWithReportContext({ reportId: 'r1' }, () => fetchCandidateComps(graphState()));
    expect(out.comparables?.map((c) => c.id)).toEqual(['NEAR', 'FAR']);
    expect(out.errors).toBeUndefined();
  });

  it('degrades to an empty pool + PARTIAL_DATA error when REA is blocked', async () => {
    mockReaBlocked(server);
    const out = await runWithReportContext({ reportId: 'r2' }, () => fetchCandidateComps(graphState()));
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/fetchCandidateComps.test.ts`
Expected: FAIL — `Cannot find module '@/agents/nodes/03_fetchCandidateComps'` (and `@/agents/annotation`).

- [ ] **Step 4: Loosen `mergeByKey` in `src/agents/state.ts`**

Change ONLY the generic constraint on the signature (line ~19). Replace:

```ts
export function mergeByKey<T extends Record<string, unknown>>(keyField: keyof T) {
```

with:

```ts
export function mergeByKey<T extends object>(keyField: keyof T) {
```

The body already casts to `Record<string, unknown>` where it spreads, so no other change is needed. Behaviour is identical; `tests/unit/state-helpers.test.ts` stays green (verified in Step 8).

- [ ] **Step 5: Create `src/agents/annotation.ts`**

```ts
// src/agents/annotation.ts — minimal LangGraph state (CLAUDE.md §6.1), grown per
// node. Reuses the reducers in state.ts: comparables merge-by-key on `id`,
// errors append, singletons last-value.

import { appendReducer, mergeByKey } from '@/agents/state';
import type { Comparable, ResolvedAddress, SubjectProperty } from '@/schemas/state';
import { Annotation } from '@langchain/langgraph';

export const GraphAnnotation = Annotation.Root({
  reportId: Annotation<string>(),
  resolvedAddress: Annotation<ResolvedAddress | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  subject: Annotation<SubjectProperty | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  comparables: Annotation<Comparable[]>({
    reducer: mergeByKey<Comparable>('id'),
    default: () => [],
  }),
  errors: Annotation<{ code: string; message: string }[]>({
    reducer: appendReducer,
    default: () => [],
  }),
});

export type GraphState = typeof GraphAnnotation.State;
```

- [ ] **Step 6: Create `src/agents/nodes/03_fetchCandidateComps.ts`**

```ts
// src/agents/nodes/03_fetchCandidateComps.ts — Node 03 (CLAUDE.md §7.3).
// Reads seeded resolvedAddress + subject, runs selectComparables, degrades
// in-band (§7.17). Never throws.

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import { selectComparables } from '@/tools/comps/selectComparables';

export async function fetchCandidateComps(state: GraphState): Promise<Partial<GraphState>> {
  const { resolvedAddress, subject } = state;
  if (!resolvedAddress || !subject) {
    return {
      errors: [
        { code: 'PARTIAL_DATA', message: 'fetchCandidateComps: missing resolvedAddress or subject' },
      ],
    };
  }

  try {
    const comparables = await selectComparables({
      subject: {
        beds: subject.attrs.beds,
        baths: subject.attrs.baths,
        landArea: subject.attrs.landArea,
        propertyType: subject.attrs.propertyType,
      },
      geo: { lat: resolvedAddress.lat, lng: resolvedAddress.lng },
      location: {
        suburb: resolvedAddress.suburb,
        state: resolvedAddress.state,
        postcode: resolvedAddress.postcode,
      },
    });
    return { comparables };
  } catch (err) {
    logger.warn({ err }, 'fetchCandidateComps: REA comp fetch failed; degrading to empty pool');
    return {
      comparables: [],
      errors: [{ code: 'PARTIAL_DATA', message: `fetchCandidateComps: ${(err as Error).message}` }],
    };
  }
}
```

- [ ] **Step 7: Run the node test to verify it passes**

Run: `pnpm vitest run tests/unit/fetchCandidateComps.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Format, confirm the reducer change is safe, run the full gate**

```bash
pnpm exec biome check --write src/agents/annotation.ts src/agents/nodes/03_fetchCandidateComps.ts src/agents/state.ts tests/fixtures/comps.ts tests/unit/fetchCandidateComps.test.ts
```
Then: `pnpm vitest run tests/unit/state-helpers.test.ts` (Expected: PASS — `mergeByKey` behaviour unchanged), then `pnpm typecheck && pnpm lint && pnpm test` (Expected: all PASS).

- [ ] **Step 9: Commit**

```bash
git add src/agents/state.ts src/agents/annotation.ts src/agents/nodes/03_fetchCandidateComps.ts tests/fixtures/comps.ts tests/unit/fetchCandidateComps.test.ts
git commit -m "feat: GraphAnnotation + fetchCandidateComps (Node 03)"
```

---

## Task 2: Graph wiring + integration test

**Files:**
- Create: `src/agents/graph.ts`
- Test: `tests/unit/graph.test.ts`

- [ ] **Step 1: Write the graph integration test**

```ts
// tests/unit/graph.test.ts
import { runGraph } from '@/agents/graph';
import { REA_HOST, listing, mockReaBlocked, mockReaOk, sampleResolvedAddress, sampleSubject } from '../fixtures/comps';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

const input = { reportId: 'r1', resolvedAddress: sampleResolvedAddress, subject: sampleSubject };

describe('reportGraph', () => {
  it('runs Node 03 and lands ranked comparables in state', async () => {
    mockReaOk(server, [
      listing('FAR', { beds: 5, lat: -33.86, lng: 151.2 }),
      listing('NEAR', { beds: 3, lat: -33.8201, lng: 151.2401 }),
    ]);
    const state = await runGraph(input);
    expect(state.comparables.map((c) => c.id)).toEqual(['NEAR', 'FAR']);
    expect(state.comparables[0]?.selection).toBe('candidate');
    expect(state.errors).toEqual([]);
  });

  it('completes with an empty pool + PARTIAL_DATA error when REA is blocked', async () => {
    mockReaBlocked(server);
    const state = await runGraph(input);
    expect(state.comparables).toEqual([]);
    expect(state.errors[0]?.code).toBe('PARTIAL_DATA');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/graph.test.ts`
Expected: FAIL — `Cannot find module '@/agents/graph'`.

- [ ] **Step 3: Create `src/agents/graph.ts`**

```ts
// src/agents/graph.ts — the report graph. This increment: START → Node 03 → END,
// compiled in-memory (no checkpointer; PostgresSaver lands with Inngest). Grows
// as nodes are added.

import { GraphAnnotation, type GraphState } from '@/agents/annotation';
import { fetchCandidateComps } from '@/agents/nodes/03_fetchCandidateComps';
import { runWithReportContext } from '@/agents/reportContext';
import { END, START, StateGraph } from '@langchain/langgraph';

export const reportGraph = new StateGraph(GraphAnnotation)
  .addNode('fetchCandidateComps', fetchCandidateComps)
  .addEdge(START, 'fetchCandidateComps')
  .addEdge('fetchCandidateComps', END)
  .compile();

/**
 * Invoke the graph with a per-report context so the RapidAPI per-report quota
 * (rapidApiCall → reportCtx) is enforced. `input` seeds the graph's initial state.
 */
export async function runGraph(input: Partial<GraphState>): Promise<GraphState> {
  const reportId = input.reportId ?? 'adhoc';
  return runWithReportContext({ reportId }, () => reportGraph.invoke(input));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/graph.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Format + full gate**

```bash
pnpm exec biome check --write src/agents/graph.ts tests/unit/graph.test.ts
```
Then: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS (graph wiring green; full suite green).

- [ ] **Step 6: Commit**

```bash
git add src/agents/graph.ts tests/unit/graph.test.ts
git commit -m "feat: report graph wiring (START -> fetchCandidateComps -> END) + runGraph"
```

---

## Self-review (done while writing)

- **Spec coverage:** §2 files → Tasks 1+2 file map. §3 Annotation + `mergeByKey` fix → Task 1 Steps 4–5. §4 node → Task 1 Step 6. §5 graph + `runGraph` → Task 2 Step 3. §6 degradation → node catch + missing-input branch (Task 1) and asserted in both test files. §7 tests → node tests (Task 1 Step 2) + graph tests (Task 2 Step 1); the dropped reducer-wiring case stays dropped (noted in spec). §8 out-of-scope → nothing here touches checkpointer/Inngest/NSW-VG/Nodes 01-02. §9 DoD → Step 8/5 gates + scoped commits.
- **Placeholder scan:** none — full code in every step.
- **Type consistency:** `GraphState` defined in `annotation.ts` (Task 1) and consumed by the node (Task 1) + graph (Task 2) + fixtures; `mergeByKey<Comparable>('id')` works only after the Step-4 loosening (sequenced before `annotation.ts` typecheck at Step 8); `fetchCandidateComps` signature `(GraphState) => Partial<GraphState>` matches `addNode` usage; `runGraph(Partial<GraphState>) => Promise<GraphState>` consumed by both graph tests; REA mock fixtures match the shapes `reaAutoComplete`/`reaSearchSold` parse.

## Done criteria

- `GraphAnnotation`, `fetchCandidateComps`, `reportGraph`/`runGraph` implemented; `mergeByKey` loosened.
- `state-helpers.test.ts` still green; node (3) + graph (2) tests green; `pnpm typecheck && pnpm lint && pnpm test` all pass.
- Changes limited to the seven files in the file map; `CLAUDE.md` untouched.
