# Design: Nodes 01/02 (address + subject input) + Domain-leftover cleanup

- **Date:** 2026-05-30
- **Status:** Draft (design approved; owner delegated remaining calls)
- **Scope:** Node 01 `resolveAddress` (real graph node) + a boundary `buildSubject` validator + v2 schema cleanup, so the graph runs from a raw address + human-supplied subject instead of seeded `resolvedAddress`/`subject`.
- **Builds on:** the graph framework (`src/agents/graph.ts`, `annotation.ts`, `fetchCandidateComps`).

---

## 1. Context & decisions

The graph currently starts from seeded `{resolvedAddress, subject}`. This increment makes both **real inputs**: an address string the user provides, geocoded by Node 01; and the human-supplied subject, validated at the boundary. It also clears two Domain-pivot leftovers in the schema.

**Owner-approved decisions:**
1. **Property identity:** drop `ResolvedAddress.domainPropertyId`; identity is `normalizedAddress` (keep `gnafId?` optional). **The `reports.domain_property_id` DB column is left as-is** (unbuilt dedupe dialog; a migration is out of scope here).
2. **`domainAvm`:** remove `SubjectProperty.domainAvm` and the now-unused `DomainAvmSchema`. `TriangulatedValue`'s separate `domainAvm` number stays until the triangulation increment. The `sources.ts` JSON-Pointer example comment is updated off `domainAvm`.
3. **Subject entry:** the subject is a **validated graph input** produced by a boundary `buildSubject(raw)` — not a graph node. Node 01 is the only new graph node.

## 2. Schema changes — `src/schemas/state.ts` (+ `sources.ts`)

- **`ResolvedAddressSchema`:** remove `domainPropertyId`. Result: `{ gnafId?, lat, lng, suburb, postcode, state, normalizedAddress }`.
- **`SubjectPropertySchema`:** remove `domainAvm`. Result: `{ attrs, photos, listing, visionAnalysis, streetView }`.
- **Remove `DomainAvmSchema`** (only consumer was `SubjectProperty.domainAvm`; `TriangulatedValue.domainAvm` is a plain `z.number()`, unaffected).
- **Add `CanonicalPropertyTypeSchema`** = `z.enum(['House','ApartmentUnitFlat','Townhouse','Villa','Land','Other'])` (the vocab `similarityScore`'s `'House'` term + `mapReaPropertyType`'s outputs already use). Used by `buildSubject` (§4). `PropertyAttrsSchema.propertyType` stays `z.string()` (no ripple to `Comparable`).
- **`sources.ts`:** change the two `domainAvm` example mentions (comment + regex message) to a neutral example, e.g. `/comparables/0/salePrice`. The regex is unchanged.

## 3. Node 01 `resolveAddress` — `src/agents/nodes/01_resolveAddress.ts`

A graph node `(GraphState) => Partial<GraphState>`:
1. Read `state.rawAddress`; if empty → throw `AddressResolutionError`.
2. `forwardGeocode(rawAddress)` (extended, §5). If null or `confidence` below threshold → `AddressResolutionError`.
3. If `suburb`/`postcode`/`state` missing from the geocode → `AddressResolutionError` ('incomplete geocode').
4. Normalize `state` to upper-case; if not in `{NSW, VIC, WA}` → `UnsupportedRegionError`.
5. Emit `{ resolvedAddress: { lat, lng, suburb, postcode, state, normalizedAddress: matchedAddress ?? rawAddress } }`.

`AddressResolutionError`/`UnsupportedRegionError` already exist (`src/lib/errors.ts`). An unresolvable/unsupported address is a **hard fail** (the node throws) per §7.1 — not an in-band degrade. (The future Inngest wrapper turns that into a failed report.)

## 4. `buildSubject` — `src/agents/subject.ts`

Boundary validator/normalizer, **not a graph node**. The caller runs it before `runGraph` and passes the result as the `subject` input.

```ts
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
  const p = RawSubjectSchema.parse(raw); // throws ZodError on invalid input
  return { attrs: p.attrs, photos: p.photos, listing: p.listing ?? null, visionAnalysis: null, streetView: null };
}
```

Constraining `propertyType` to the canonical enum (the UI supplies one of these) keeps subject + comp `propertyType` drawn from the same vocab, so `similarityScore`'s exact-match term is sound.

## 5. Mapbox geocode extension — `src/tools/mapbox/geocode.ts`

`forwardGeocode` has no consumers yet, so extend it freely. Parse Mapbox v6 `features[].properties.context` for suburb/postcode/state and widen `GeocodeResult`:

```ts
interface GeocodeResult {
  lat: number;
  lng: number;
  confidence: number;
  matchedAddress: string | null;
  suburb: string | null;   // context.locality?.name ?? context.place?.name
  postcode: string | null; // context.postcode?.name
  state: string | null;    // context.region?.region_code  (e.g. 'NSW')
}
```

The exact v6 `context` field paths are verified against the live response shape when writing the plan; the Zod schema treats every context sub-field as optional and `resolveAddress` validates presence.

## 6. Graph rewiring — `annotation.ts` + `graph.ts`

- **`annotation.ts`:** add `rawAddress: Annotation<string>()` (last-value input channel). `resolvedAddress` channel already exists.
- **`graph.ts`:** `START → resolveAddress → fetchCandidateComps → END`. `runGraph({ reportId, rawAddress, subject })` — `subject` is the validated `buildSubject` output; `resolvedAddress` is produced by Node 01.

## 7. Testing

- **`tests/unit/resolveAddress.test.ts`** (node unit): mock `forwardGeocode` (via MSW on the Mapbox host, or by mocking the module) → happy path emits a valid `ResolvedAddress`; missing `rawAddress` → throws `AddressResolutionError`; geocode returns a non-AU/`'QLD'` state → throws `UnsupportedRegionError`; incomplete geocode (no suburb) → throws `AddressResolutionError`.
- **`tests/unit/buildSubject.test.ts`**: valid raw → `SubjectProperty` (visionAnalysis/streetView null, listing defaulted); invalid propertyType / missing field → throws `ZodError`.
- **`tests/unit/mapbox-geocode.test.ts`** (extend or add): a v6 response with `context` → `GeocodeResult` carries suburb/postcode/state.
- **Update `tests/unit/graph.test.ts`**: seed `{ reportId, rawAddress, subject }`, mock Mapbox + REA → assert `state.resolvedAddress` set and `state.comparables` ranked. (The old seed of `resolvedAddress` is replaced by `rawAddress` + a mocked geocode.)
- **Update `tests/fixtures/comps.ts`**: drop `domainAvm` from `sampleSubject`, drop `domainPropertyId` from `sampleResolvedAddress`, add `sampleRawAddress` + a Mapbox mock helper.

## 8. Out of scope

- The `reports.domain_property_id` DB migration (dedupe dialog).
- Vision over subject photos (Node 04a), Street View (04c).
- NSW VG, triangulation, compose, render, Inngest, downstream nodes.
- A report-creation UI/API that calls `buildSubject` + `runGraph` (this increment provides the functions; wiring them to a route is later).

## 9. Definition of done

- Schema leftovers removed; `CanonicalPropertyTypeSchema` added; `sources.ts` comment updated.
- `resolveAddress` node, `buildSubject`, and the extended `forwardGeocode` implemented per §3–§6; `rawAddress` channel + `resolveAddress` wired into the graph.
- New unit tests + updated graph test + fixtures; `pnpm typecheck && pnpm lint && pnpm test` all green.
- `CLAUDE.md` untouched; no DB migration.
