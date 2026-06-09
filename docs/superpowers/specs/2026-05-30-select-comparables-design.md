# Design: `selectComparables` — Node 03's comp-selection logic

- **Date:** 2026-05-30
- **Status:** Draft for review
- **Scope:** A pure, deterministic comp-selection function (no graph, no LLM, no NSW VG)
- **Builds on:** `docs/superpowers/specs/2026-05-30-rapidapi-comps-integration-design.md` (the REA comp source, now shipped)

---

## 1. Context

The REA comp tool (`fetchReaSoldComparables`, `similarityScore`, `Comparable`) is built and tested. The next increment is **Node 03's core job (§7.3)**: turn the subject + its location into a **scored, ranked candidate comp pool** (top 30, all `selection: 'candidate'`).

This is intentionally *just the logic*, as a pure async function — not a LangGraph node. The graph framework, the subject input path (Nodes 01/02), and the NSW VG reconciliation are separate increments (see §6). Extracting the logic first gives a fully unit-testable unit that later becomes the exact body of the graph node.

**Not in this unit:** fair-value / negotiation-anchor **tiering**. Per §7.8 that is an LLM reasoning task (Node 06 `reasonAndSelect`), not a deterministic one. Keeping it out is both architecturally correct and keeps this function pure.

## 2. Contract

```ts
import type { SimilaritySubject } from '@/tools/comps/similarity';
import type { Comparable } from '@/schemas/state';

export interface SelectCompsInput {
  /** Subject attributes in the canonical vocab ('House' triggers the land-area term). */
  subject: SimilaritySubject; // { beds, baths, landArea: number|null, propertyType }
  /** Subject coordinates (from resolvedAddress) for distance scoring. */
  geo: { lat: number; lng: number };
  /** Used to resolve the REA locationId. */
  location: { suburb: string; state: string; postcode: string };
}

export interface SelectCompsOpts {
  maxCandidates?: number; // default 30 (§7.3)
  withinDays?: number;    // default 180 (§7.3)
  now?: Date;             // default new Date() — injectable seam for deterministic tests
}

export async function selectComparables(
  input: SelectCompsInput,
  opts?: SelectCompsOpts,
): Promise<Comparable[]>;
```

- **Returns** the candidate comps sorted by `similarityScore` descending, capped at `maxCandidates`. Every entry keeps `selection: 'candidate'`; `similarityScore` is populated (overwriting the `0` placeholder `toComparable` sets).
- **Returns `[]`** when REA yields no usable comps (the future graph node degrades to NSW VG; this function does not).

## 3. Flow

1. **Resolve REA `locationId`.**
   - Call `reaAutoComplete(`${suburb} ${state}`)`. Pick `locs.find(l => l.type === 'suburb') ?? locs[0]`, use its `locationId`.
   - If autocomplete returns an **empty** list, fall back to building `suburb:${suburb}, ${state} ${postcode}` (the observed REA format, e.g. `suburb:Mosman, NSW 2088`).
   - If `reaAutoComplete` **throws** (REA down / schema drift), let it propagate — the caller/node decides degradation. (Empty result ≠ thrown error.)
2. **Fetch candidates.** `fetchReaSoldComparables({ locationId, subject: input.geo, withinDays })` — already 180-day-filtered, deduped, `distanceM` computed.
3. **Score.** For each comp compute
   `weeksSinceSale = (now.getTime() − Date.parse(comp.contractDate)) / (7 * 86_400_000)` (floored at 0),
   then `comp.similarityScore = similarityScore(input.subject, { beds, baths, landArea, propertyType, weeksSinceSale, distanceM: comp.distanceM })`.
4. **Rank + cap.** Sort by `similarityScore` desc (stable; tie-break by `distanceM` asc for determinism), `slice(0, maxCandidates)`.
5. **Return** the ranked array (entries unchanged except `similarityScore`).

## 4. Error / degradation behaviour

- `reaAutoComplete` / `fetchReaSoldComparables` throwing (RapidApiQuotaError, SchemaDriftError, transport) **propagates** — the node wrapper (future) catches and degrades to NSW VG per §7.17.
- Empty REA result → `[]` (not an error).
- No mutation of inputs; comps are returned as new objects with `similarityScore` set.

## 5. Files & testing

- **Create:** `src/tools/comps/selectComparables.ts`
- **Test:** `tests/unit/selectComparables.test.ts` (MSW for the REA `/auto-complete` + `/properties/search` calls; wrap in `runWithReportContext`).

Test cases:
- **Ranking:** two comps where a nearer, same-bed comp outranks a far, bed-mismatched one (assert returned order).
- **Top-N cap:** feed >maxCandidates listings, assert length === maxCandidates and they're the highest scorers.
- **Score populated:** every returned comp has `similarityScore > 0` and `selection === 'candidate'`.
- **locationId resolution:** autocomplete hit → uses returned `locationId`; autocomplete empty → uses the built `suburb:…` fallback (assert the search request carried the fallback id).
- **Empty REA → `[]`.**
- **`now` seam:** with a fixed `opts.now`, a 30-week-old comp gets the full recency deduction vs a 1-week-old comp (deterministic recency term).

## 6. Out of scope (later increments)

- Graph-node wrapper (`Annotation.Root` state, `graph.ts`) — needs the graph framework.
- NSW VG reconciliation (`rea+nsw-vg`) — needs `src/tools/nsw-vg/` ingest + PostGIS query.
- Fair-value / negotiation-anchor tiering — Node 06 (LLM).
- Subject input path — Nodes 01 (resolveAddress) / 02 (human-supplied subject).

## 7. Definition of done

- `selectComparables` implemented per §2–§4; pure (no graph/LLM/DB).
- `tests/unit/selectComparables.test.ts` covers §5; `pnpm typecheck && pnpm lint && pnpm test` green.
- No changes outside `src/tools/comps/selectComparables.ts` + its test.
