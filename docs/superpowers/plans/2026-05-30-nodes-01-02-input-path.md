# Nodes 01/02 Input Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the graph run from a raw address + human-supplied subject: add Node 01 `resolveAddress` (geocode), a boundary `buildSubject` validator, and clear two Domain-pivot schema leftovers.

**Architecture:** Five small, dependency-ordered tasks — (1) schema cleanup + canonical property-type enum, (2) extend Mapbox `forwardGeocode` to emit suburb/postcode/state, (3) `buildSubject` boundary validator, (4) `resolveAddress` graph node + `rawAddress` channel, (5) wire `START → resolveAddress → fetchCandidateComps → END`.

**Tech Stack:** `@langchain/langgraph@0.2.34`, Zod 3.25, TypeScript (strict, `noUncheckedIndexedAccess`), Vitest 2.1 + MSW 2.6 (faked `Date` not needed here — geocode/subject are clock-free; the graph test reuses the REA mocks), Biome. `@/` → `src/`.

**Reference spec:** `docs/superpowers/specs/2026-05-30-nodes-01-02-input-path-design.md`

**Verified facts:** Mapbox v6 `features[].properties.context` is an object keyed by feature type; `context.region.region_code` is the state abbrev (`'NSW'`), `context.postcode.name` the postcode, `context.locality.name` / `context.place.name` the suburb; `properties.full_address` is the formatted address. Removing `ResolvedAddress.domainPropertyId` / `SubjectProperty.domainAvm` / `DomainAvmSchema` affects only `tests/fixtures/comps.ts` (the `schema.smoke.test.ts` `domainPropertyId` is the kept DB column; `triangulation.test.ts` `domainAvm` is the kept `TriangulatedValue` field; `state-helpers.test.ts` uses a synthetic object).

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/schemas/state.ts` | drop `domainPropertyId`/`domainAvm`/`DomainAvmSchema`; add `CanonicalPropertyTypeSchema` | Modify |
| `src/schemas/sources.ts` | update the `domainAvm` example comment | Modify |
| `src/tools/mapbox/geocode.ts` | parse `context` → suburb/postcode/state | Modify |
| `src/agents/subject.ts` | `buildSubject` boundary validator | Create |
| `src/agents/annotation.ts` | add `rawAddress` channel | Modify |
| `src/agents/nodes/01_resolveAddress.ts` | Node 01 | Create |
| `src/agents/graph.ts` | wire `resolveAddress` | Modify |
| `tests/fixtures/comps.ts` | drop removed fields; add `sampleRawAddress`, `rawAddress` to `graphState`, `mockMapbox` | Modify |
| `tests/unit/{canonicalPropertyType,mapbox-geocode,buildSubject,resolveAddress}.test.ts` | unit tests | Create |
| `tests/unit/graph.test.ts` | re-seed with `rawAddress` + mocked geocode | Modify |

---

## Task 1: Schema cleanup + canonical property-type enum

**Files:**
- Modify: `src/schemas/state.ts`, `src/schemas/sources.ts`, `tests/fixtures/comps.ts`
- Test: `tests/unit/canonicalPropertyType.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/canonicalPropertyType.test.ts
import { CanonicalPropertyTypeSchema } from '@/schemas/state';
import { describe, expect, it } from 'vitest';

describe('CanonicalPropertyTypeSchema', () => {
  it('accepts the canonical vocab', () => {
    for (const t of ['House', 'ApartmentUnitFlat', 'Townhouse', 'Villa', 'Land', 'Other']) {
      expect(CanonicalPropertyTypeSchema.parse(t)).toBe(t);
    }
  });
  it('rejects non-canonical values', () => {
    expect(CanonicalPropertyTypeSchema.safeParse('apartment').success).toBe(false);
    expect(CanonicalPropertyTypeSchema.safeParse('house').success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/canonicalPropertyType.test.ts`
Expected: FAIL — `CanonicalPropertyTypeSchema` is not exported.

- [ ] **Step 3a: Edit `src/schemas/state.ts`**

After the `AusStateSchema` definition, add:

```ts
export const CanonicalPropertyTypeSchema = z.enum([
  'House',
  'ApartmentUnitFlat',
  'Townhouse',
  'Villa',
  'Land',
  'Other',
]);
```

In `ResolvedAddressSchema`, delete the line `domainPropertyId: z.string(),`.

Delete the entire `DomainAvmSchema` definition (the `export const DomainAvmSchema = z.object({ low, mid, high, confidence, source }) ;` block).

In `SubjectPropertySchema`, delete the line `domainAvm: DomainAvmSchema,`.

- [ ] **Step 3b: Edit `src/schemas/sources.ts`**

Replace the two `/subject/domainAvm/mid` example mentions (the comment above `path:` and the regex error message string) with `/comparables/0/salePrice`. Do NOT change the regex pattern itself.

- [ ] **Step 3c: Edit `tests/fixtures/comps.ts`**

In `sampleResolvedAddress`, delete the `domainPropertyId: 'p1',` line. In `sampleSubject`, delete the entire `domainAvm: { ... }` property.

- [ ] **Step 4: Run the new test + confirm nothing else broke**

```bash
pnpm exec biome check --write src/schemas/state.ts src/schemas/sources.ts tests/fixtures/comps.ts tests/unit/canonicalPropertyType.test.ts
pnpm vitest run tests/unit/canonicalPropertyType.test.ts
pnpm typecheck && pnpm lint && pnpm test
```
Expected: new test PASS; typecheck clean (fixtures compile without the removed fields); full suite green (state-helpers, triangulation, schema.smoke, fetchCandidateComps, graph all still pass).

- [ ] **Step 5: Commit**

```bash
git add src/schemas/state.ts src/schemas/sources.ts tests/fixtures/comps.ts tests/unit/canonicalPropertyType.test.ts
git commit -m "refactor: drop Domain leftovers (domainPropertyId/domainAvm); add CanonicalPropertyType"
```

---

## Task 2: Mapbox `forwardGeocode` — extract suburb/postcode/state

**Files:**
- Modify: `src/tools/mapbox/geocode.ts`
- Test: `tests/unit/mapbox-geocode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mapbox-geocode.test.ts
import { forwardGeocode } from '@/tools/mapbox/geocode';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  process.env.MAPBOX_TOKEN = 'test-token';
});

const v6 = {
  features: [
    {
      properties: {
        full_address: '1 Awaba St, Mosman NSW 2088, Australia',
        name: '1 Awaba St',
        coordinates: { longitude: 151.2454, latitude: -33.8284 },
        context: {
          region: { name: 'New South Wales', region_code: 'NSW' },
          postcode: { name: '2088' },
          locality: { name: 'Mosman' },
          place: { name: 'Sydney' },
        },
      },
      geometry: { type: 'Point', coordinates: [151.2454, -33.8284] },
    },
  ],
};

describe('forwardGeocode', () => {
  it('extracts suburb/postcode/state from the v6 context', async () => {
    server.use(
      http.get('https://api.mapbox.com/search/geocode/v6/forward', () => HttpResponse.json(v6)),
    );
    const out = await forwardGeocode('1 Awaba St Mosman');
    expect(out).not.toBeNull();
    expect(out?.lat).toBeCloseTo(-33.8284, 3);
    expect(out?.suburb).toBe('Mosman');
    expect(out?.postcode).toBe('2088');
    expect(out?.state).toBe('NSW');
  });

  it('returns null fields when context is absent', async () => {
    server.use(
      http.get('https://api.mapbox.com/search/geocode/v6/forward', () =>
        HttpResponse.json({
          features: [{ properties: { name: 'X' }, geometry: { type: 'Point', coordinates: [151, -33] } }],
        }),
      ),
    );
    const out = await forwardGeocode('nowhere');
    expect(out?.suburb).toBeNull();
    expect(out?.state).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/mapbox-geocode.test.ts`
Expected: FAIL — `out.suburb`/`postcode`/`state` are `undefined` (not yet on `GeocodeResult`).

- [ ] **Step 3: Edit `src/tools/mapbox/geocode.ts`**

Add a context schema and widen the feature schema. Insert before `MAPBOX_FEATURE`:

```ts
const MAPBOX_CONTEXT = z
  .object({
    region: z.object({ name: z.string().optional(), region_code: z.string().optional() }).optional(),
    postcode: z.object({ name: z.string().optional() }).optional(),
    locality: z.object({ name: z.string().optional() }).optional(),
    place: z.object({ name: z.string().optional() }).optional(),
  })
  .optional();
```

In `MAPBOX_FEATURE.properties`, add `context: MAPBOX_CONTEXT,`.

Widen `GeocodeResult` to add:

```ts
  suburb: string | null;
  postcode: string | null;
  state: string | null;
```

In the `return` of `forwardGeocode`, compute and include them:

```ts
  const ctx = feature.properties.context;
  return {
    lat,
    lng,
    confidence: 1,
    matchedAddress: feature.properties.full_address ?? feature.properties.name ?? null,
    suburb: ctx?.locality?.name ?? ctx?.place?.name ?? null,
    postcode: ctx?.postcode?.name ?? null,
    state: ctx?.region?.region_code ?? null,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/mapbox-geocode.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Format + full gate**

```bash
pnpm exec biome check --write src/tools/mapbox/geocode.ts tests/unit/mapbox-geocode.test.ts
pnpm typecheck && pnpm lint && pnpm test
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/mapbox/geocode.ts tests/unit/mapbox-geocode.test.ts
git commit -m "feat: forwardGeocode extracts suburb/postcode/state from Mapbox v6 context"
```

---

## Task 3: `buildSubject` boundary validator

**Files:**
- Create: `src/agents/subject.ts`
- Test: `tests/unit/buildSubject.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/buildSubject.test.ts
import { buildSubject } from '@/agents/subject';
import { describe, expect, it } from 'vitest';

const raw = {
  attrs: { beds: 3, baths: 2, parking: 1, landArea: 500, buildingArea: null, propertyType: 'House' },
  photos: ['https://example.com/a.jpg'],
};

describe('buildSubject', () => {
  it('validates + normalizes a raw subject into SubjectProperty', () => {
    const s = buildSubject(raw);
    expect(s.attrs.propertyType).toBe('House');
    expect(s.photos).toEqual(['https://example.com/a.jpg']);
    expect(s.listing).toBeNull();
    expect(s.visionAnalysis).toBeNull();
    expect(s.streetView).toBeNull();
  });

  it('throws on a non-canonical propertyType', () => {
    expect(() => buildSubject({ ...raw, attrs: { ...raw.attrs, propertyType: 'apartment' } })).toThrow();
  });

  it('throws on a missing required attr', () => {
    expect(() => buildSubject({ attrs: { beds: 3 }, photos: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/buildSubject.test.ts`
Expected: FAIL — `Cannot find module '@/agents/subject'`.

- [ ] **Step 3: Create `src/agents/subject.ts`**

```ts
// src/agents/subject.ts — boundary validator that turns the human-supplied raw
// subject payload into a SubjectProperty. Called before runGraph (not a graph
// node). propertyType is constrained to the canonical vocab so subject + comp
// types share one vocabulary for similarity scoring.

import { CanonicalPropertyTypeSchema } from '@/schemas/state';
import type { SubjectProperty } from '@/schemas/state';
import { ListingSchema } from '@/schemas/state';
import { z } from 'zod';

const RawSubjectSchema = z.object({
  attrs: z.object({
    beds: z.number().int().nonnegative(),
    baths: z.number().int().nonnegative(),
    parking: z.number().int().nonnegative(),
    landArea: z.number().nonnegative().nullable(),
    buildingArea: z.number().nonnegative().nullable(),
    propertyType: CanonicalPropertyTypeSchema,
  }),
  photos: z.array(z.string().url()),
  listing: ListingSchema.nullable().optional(),
});

export function buildSubject(raw: unknown): SubjectProperty {
  const p = RawSubjectSchema.parse(raw);
  return {
    attrs: p.attrs,
    photos: p.photos,
    listing: p.listing ?? null,
    visionAnalysis: null,
    streetView: null,
  };
}
```

> `ListingSchema` is exported from `src/schemas/state.ts`. If it is not yet exported, add `export` to its declaration as part of this task (it is one of the named files only if needed — otherwise it is already exported; verify with `grep -n "ListingSchema" src/schemas/state.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/buildSubject.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Format + full gate**

```bash
pnpm exec biome check --write src/agents/subject.ts tests/unit/buildSubject.test.ts
pnpm typecheck && pnpm lint && pnpm test
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agents/subject.ts tests/unit/buildSubject.test.ts
git commit -m "feat: buildSubject boundary validator (raw payload -> SubjectProperty)"
```

---

## Task 4: `resolveAddress` node + `rawAddress` channel

**Files:**
- Modify: `src/agents/annotation.ts` (add `rawAddress` channel)
- Modify: `tests/fixtures/comps.ts` (add `rawAddress: ''` default to `graphState`; add `sampleRawAddress`)
- Create: `src/agents/nodes/01_resolveAddress.ts`
- Test: `tests/unit/resolveAddress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/resolveAddress.test.ts
import { graphState } from '../fixtures/comps';
import { resolveAddress } from '@/agents/nodes/01_resolveAddress';
import { AddressResolutionError, UnsupportedRegionError } from '@/lib/errors';
import { forwardGeocode } from '@/tools/mapbox/geocode';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/tools/mapbox/geocode', () => ({ forwardGeocode: vi.fn() }));
const mockGeocode = vi.mocked(forwardGeocode);

const geo = (over = {}) => ({
  lat: -33.8284,
  lng: 151.2454,
  confidence: 1,
  matchedAddress: '1 Awaba St, Mosman NSW 2088',
  suburb: 'Mosman',
  postcode: '2088',
  state: 'NSW',
  ...over,
});

beforeEach(() => mockGeocode.mockReset());

describe('resolveAddress', () => {
  it('emits a ResolvedAddress on a good geocode', async () => {
    mockGeocode.mockResolvedValue(geo());
    const out = await resolveAddress(graphState({ rawAddress: '1 Awaba St Mosman' }));
    expect(out.resolvedAddress?.suburb).toBe('Mosman');
    expect(out.resolvedAddress?.state).toBe('NSW');
    expect(out.resolvedAddress?.normalizedAddress).toBe('1 Awaba St, Mosman NSW 2088');
  });

  it('throws AddressResolutionError when rawAddress is empty', async () => {
    await expect(resolveAddress(graphState({ rawAddress: '' }))).rejects.toBeInstanceOf(AddressResolutionError);
  });

  it('throws AddressResolutionError when geocode returns null', async () => {
    mockGeocode.mockResolvedValue(null);
    await expect(resolveAddress(graphState({ rawAddress: 'x' }))).rejects.toBeInstanceOf(AddressResolutionError);
  });

  it('throws UnsupportedRegionError for a non-NSW/VIC/WA state', async () => {
    mockGeocode.mockResolvedValue(geo({ state: 'QLD' }));
    await expect(resolveAddress(graphState({ rawAddress: 'x' }))).rejects.toBeInstanceOf(UnsupportedRegionError);
  });

  it('throws AddressResolutionError when the geocode is missing a suburb', async () => {
    mockGeocode.mockResolvedValue(geo({ suburb: null }));
    await expect(resolveAddress(graphState({ rawAddress: 'x' }))).rejects.toBeInstanceOf(AddressResolutionError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/resolveAddress.test.ts`
Expected: FAIL — `Cannot find module '@/agents/nodes/01_resolveAddress'`.

- [ ] **Step 3a: Add the `rawAddress` channel to `src/agents/annotation.ts`**

Add this channel to the `Annotation.Root({ ... })` object (e.g. right after `reportId`):

```ts
  rawAddress: Annotation<string>(),
```

- [ ] **Step 3b: Update `graphState` in `tests/fixtures/comps.ts`**

Add `rawAddress: ''` to the object `graphState` returns (so the full `GraphState` is satisfied), and export a sample:

```ts
export const sampleRawAddress = '1 Awaba St, Mosman NSW 2088';
```

- [ ] **Step 3c: Create `src/agents/nodes/01_resolveAddress.ts`**

```ts
// src/agents/nodes/01_resolveAddress.ts — Node 01 (CLAUDE.md §7.1). Geocodes the
// raw address via Mapbox into a ResolvedAddress. Hard-fails (throws) on an
// unresolvable address or an unsupported region — not an in-band degrade.

import type { GraphState } from '@/agents/annotation';
import { AddressResolutionError, UnsupportedRegionError } from '@/lib/errors';
import type { AusStateSchema } from '@/schemas/state';
import { forwardGeocode } from '@/tools/mapbox/geocode';
import type { z } from 'zod';

type AusState = z.infer<typeof AusStateSchema>;
const SUPPORTED: readonly AusState[] = ['NSW', 'VIC', 'WA'];

function isSupported(s: string): s is AusState {
  return (SUPPORTED as readonly string[]).includes(s);
}

export async function resolveAddress(state: GraphState): Promise<Partial<GraphState>> {
  const raw = state.rawAddress?.trim();
  if (!raw) throw new AddressResolutionError('no address provided');

  const geo = await forwardGeocode(raw);
  if (!geo) throw new AddressResolutionError(`could not geocode "${raw}"`);
  if (!geo.suburb || !geo.postcode || !geo.state) {
    throw new AddressResolutionError(`incomplete geocode for "${raw}"`);
  }

  const st = geo.state.toUpperCase();
  if (!isSupported(st)) throw new UnsupportedRegionError(`region ${st} is not supported`);

  return {
    resolvedAddress: {
      lat: geo.lat,
      lng: geo.lng,
      suburb: geo.suburb,
      postcode: geo.postcode,
      state: st,
      normalizedAddress: geo.matchedAddress ?? raw,
    },
  };
}
```

> `AusStateSchema` is exported from `src/schemas/state.ts` (verify with `grep -n "AusStateSchema" src/schemas/state.ts`; it is already `export const`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/resolveAddress.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Format + full gate**

```bash
pnpm exec biome check --write src/agents/annotation.ts src/agents/nodes/01_resolveAddress.ts tests/fixtures/comps.ts tests/unit/resolveAddress.test.ts
pnpm typecheck && pnpm lint && pnpm test
```
Expected: all PASS (the existing `fetchCandidateComps.test.ts` still green — `graphState` now carries `rawAddress: ''`, unused by that node).

- [ ] **Step 6: Commit**

```bash
git add src/agents/annotation.ts src/agents/nodes/01_resolveAddress.ts tests/fixtures/comps.ts tests/unit/resolveAddress.test.ts
git commit -m "feat: resolveAddress node (Node 01) + rawAddress channel"
```

---

## Task 5: Wire `resolveAddress` into the graph

**Files:**
- Modify: `src/agents/graph.ts` (add the node + edges)
- Modify: `tests/fixtures/comps.ts` (add a `mockMapbox` MSW helper)
- Modify: `tests/unit/graph.test.ts` (re-seed with `rawAddress` + mocked geocode)

- [ ] **Step 1: Add a `mockMapbox` helper to `tests/fixtures/comps.ts`**

```ts
// (append to tests/fixtures/comps.ts — imports http/HttpResponse already present)
export function mockMapbox(server: ReturnType<typeof setupServer>) {
  server.use(
    http.get('https://api.mapbox.com/search/geocode/v6/forward', () =>
      HttpResponse.json({
        features: [
          {
            properties: {
              full_address: '1 Awaba St, Mosman NSW 2088, Australia',
              name: '1 Awaba St',
              coordinates: { longitude: 151.2454, latitude: -33.82 },
              context: {
                region: { name: 'New South Wales', region_code: 'NSW' },
                postcode: { name: '2088' },
                locality: { name: 'Mosman' },
              },
            },
            geometry: { type: 'Point', coordinates: [151.2454, -33.82] },
          },
        ],
      }),
    ),
  );
}
```

- [ ] **Step 2: Update `tests/unit/graph.test.ts`** (replace the body with the rawAddress-seeded version)

```ts
// tests/unit/graph.test.ts
import { runGraph } from '@/agents/graph';
import { REA_HOST, listing, mockMapbox, mockReaBlocked, mockReaOk, sampleRawAddress, sampleSubject } from '../fixtures/comps';
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
  process.env.MAPBOX_TOKEN = 'test-token';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-30T00:00:00Z'));
});

const input = { reportId: 'r1', rawAddress: sampleRawAddress, subject: sampleSubject };

describe('reportGraph', () => {
  it('resolves the address then lands ranked comparables', async () => {
    mockMapbox(server);
    mockReaOk(server, [
      listing('FAR', { beds: 5, lat: -33.86, lng: 151.2 }),
      listing('NEAR', { beds: 3, lat: -33.8201, lng: 151.2401 }),
    ]);
    const state = await runGraph(input);
    expect(state.resolvedAddress?.suburb).toBe('Mosman');
    expect(state.comparables.map((c) => c.id)).toEqual(['NEAR', 'FAR']);
    expect(state.errors).toEqual([]);
  });

  it('completes with an empty pool + PARTIAL_DATA when REA is blocked', async () => {
    mockMapbox(server);
    mockReaBlocked(server);
    const state = await runGraph(input);
    expect(state.resolvedAddress?.suburb).toBe('Mosman');
    expect(state.comparables).toEqual([]);
    expect(state.errors[0]?.code).toBe('PARTIAL_DATA');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/graph.test.ts`
Expected: FAIL — `resolveAddress` is not wired (graph has no node producing `resolvedAddress`; `fetchCandidateComps` degrades because `resolvedAddress` is null → comps empty, so the happy-path assertion fails).

- [ ] **Step 4: Wire it in `src/agents/graph.ts`**

Add the import and the node + edges:

```ts
import { resolveAddress } from '@/agents/nodes/01_resolveAddress';
```

Change the graph construction to:

```ts
export const reportGraph = new StateGraph(GraphAnnotation)
  .addNode('resolveAddress', resolveAddress)
  .addNode('fetchCandidateComps', fetchCandidateComps)
  .addEdge(START, 'resolveAddress')
  .addEdge('resolveAddress', 'fetchCandidateComps')
  .addEdge('fetchCandidateComps', END)
  .compile();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/graph.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Format + full gate**

```bash
pnpm exec biome check --write src/agents/graph.ts tests/fixtures/comps.ts tests/unit/graph.test.ts
pnpm typecheck && pnpm lint && pnpm test
```
Expected: all PASS (whole suite green).

- [ ] **Step 7: Commit**

```bash
git add src/agents/graph.ts tests/fixtures/comps.ts tests/unit/graph.test.ts
git commit -m "feat: wire resolveAddress into the graph (START -> resolveAddress -> fetchCandidateComps -> END)"
```

---

## Self-review (done while writing)

- **Spec coverage:** §2 schema changes → Task 1. §3 resolveAddress → Task 4. §4 buildSubject → Task 3. §5 mapbox extension → Task 2. §6 graph rewiring → Tasks 4 (channel) + 5 (wiring). §7 tests → one per unit + updated graph test. §8 out-of-scope → no DB migration, no vision/NSW-VG/downstream. §9 DoD → per-task gates.
- **Placeholder scan:** none — full code in every step. The two `grep -n` verify-notes (ListingSchema/AusStateSchema exports) are confirmations, not placeholders; both are already `export const`/`export` in `state.ts`.
- **Type consistency:** `CanonicalPropertyTypeSchema` (Task 1) consumed by `buildSubject` (Task 3); `GeocodeResult.{suburb,postcode,state}` (Task 2) consumed by `resolveAddress` (Task 4); `rawAddress` channel (Task 4) seeded by `graph.test.ts` (Task 5) and defaulted in `graphState` (Task 4); `resolveAddress`/`fetchCandidateComps` both `(GraphState)=>Partial<GraphState>` for `addNode`; `runGraph(Partial<GraphState>)` accepts `{reportId, rawAddress, subject}`.

## Done criteria

- Domain leftovers removed; `CanonicalPropertyTypeSchema` added; `forwardGeocode` emits suburb/postcode/state; `buildSubject` + `resolveAddress` implemented; graph runs `START → resolveAddress → fetchCandidateComps → END` from `{reportId, rawAddress, subject}`.
- All new + updated tests green; `pnpm typecheck && pnpm lint && pnpm test` all pass.
- Changes limited to the file map; `CLAUDE.md` untouched; no DB migration.
