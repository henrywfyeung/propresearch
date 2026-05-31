# Design: Planning-activity section (Node 05 `fetchPlanning`) — NSW Online DA API

- **Date:** 2026-06-01
- **Status:** Design (autonomous; user: "enrich further"). API live-probed 2026-06-01.
- **Scope:** Add the dossier's **planning-activity** section — recent development applications (DAs) near the subject — from the keyless NSW ePlanning Online DA Data API. Wire Node 05 into the graph, compose a `planning` section, render it. **NSW only** (VIC later).

---

## 1. Data source (live-probed, keyless)

**`GET https://api.apps1.nsw.gov.au/eplanning/data/v0/OnlineDA`** — statewide (~128 councils), daily-updated, DAs from 2018-12-10. Keyless/public.

**Non-obvious contract (the crux):**
- **`filters`, `PageNumber`, `PageSize` are HTTP *headers*, NOT query params** (query params → HTTP 400 "Required parameters … not met"). The `filters` header is a JSON string: `{"filters":{"CouncilName":["<exact council>"],"LodgementDateFrom":"YYYY-MM-DD"}}`.
- **Do NOT send any `Ocp-Apim-Subscription-Key` header** (a dummy one → 400).
- **Council-keyed, not point-keyed** — there is NO spatial param. Query by `CouncilName` + date, then filter to ≤500m **client-side** via haversine on each record's `Location[0].X` (lng) / `Location[0].Y` (lat) — **both are strings, parse to float**; drop records with missing coords.
- Pagination: response has `TotalPages`/`TotalCount`/`Application[]`; loop `PageNumber` 1..TotalPages with `PageSize: 1000`.

**Working curl (proven 200):**
```bash
curl -s "https://api.apps1.nsw.gov.au/eplanning/data/v0/OnlineDA" \
  -H 'filters: {"filters":{"CouncilName":["Mosman Municipal Council"],"LodgementDateFrom":"2025-06-01"}}' \
  -H 'PageNumber: 1' -H 'PageSize: 1000'
```

**Per-DA fields → `RecentDASchema`** (`src/schemas/state.ts`: `{description, status, category, distanceM, lodgedDate, coverage, sourceRef}`):
| RecentDA field | API source |
|---|---|
| `description` | **synthesize** — join `DevelopmentType[].DevelopmentType` (fallback `ApplicationType`), e.g. "Dwelling house; Alterations or additions" |
| `status` | `ApplicationStatus` |
| `category` | `DevelopmentCategory` (Residential/Commercial/…) or `ApplicationType` |
| `distanceM` | haversine(subject, {lat:Location[0].Y, lng:Location[0].X}) — `@/lib/geo` `haversineMeters` |
| `lodgedDate` | `LodgementDate` (YYYY-MM-DD) |
| `coverage` | `'full'` (the API gives full detail statewide; 'metadata-only' degraded mode is unused now) |
| `sourceRef` | `{provider:'nsw-planning', endpoint:OnlineDA URL, fetchedAt:now, path:'/market/recentDAs'}` |

Live-verified: Mosman → 36 DAs ≤500m (nearest 36m, 13 Lavoni St, lodged 2026-02-23). Avoid the stale mapprod3 `DA_Tracking` layer (frozen 2023).

---

## 2. LGA → CouncilName resolution
`resolveLga(lat,lng)` (built for the risk register, `@/tools/nsw-risk/lga.ts`) returns the UPPERCASE LGA name (e.g. `"MOSMAN"`), but the API needs the exact `CouncilName` (`"Mosman Municipal Council"`). Build **`src/tools/nsw-planning/councils.ts`** — a static `LGA_TO_COUNCIL: Record<string, string>` map (key = uppercase LGA name) + `lgaToCouncil(lga: string): string | null`.
- Seed it from the authoritative NSW council list (fetch the OnlineDA data-dictionary appendix PDF the research found, or a data.nsw / OLG councils dataset; the implementer fetches + generates the entries). Prefer FULL coverage of all ~128 councils.
- **If full coverage isn't cleanly obtainable**, a curated metro-Sydney map (incl. Mosman, City of Sydney, Parramatta, Inner West, Randwick, Waverley, North Sydney, Willoughby, Ku-ring-gai, etc.) + `null` for the rest is acceptable for v1 — unmapped → planning degrades to "data unavailable for this council" (§7.17). Document which path shipped.

---

## 3. Tool layer — `src/tools/nsw-planning/`
- **`councils.ts`** — the LGA→CouncilName map + `lgaToCouncil()` (§2).
- **`onlineDa.ts`** — `fetchRecentDAs(councilName: string, lodgedFrom: string): Promise<OnlineDaRecord[]>`: paginated GET with the `filters`/`PageNumber`/`PageSize` HEADERS, `pRetry` on 429/5xx (mirror `arcgisPointQuery`/`rapidApiCall`), Zod-validate a strict-but-partial schema of the fields we use (`Application[]` with `ApplicationStatus`, `LodgementDate`, `ApplicationType`, `DevelopmentCategory`, `DevelopmentType[]`, `CostOfDevelopment`, `Location[]{X,Y,FullAddress}`, `PlanningPortalApplicationNumber`). Returns all pages' records. Base overridable via `NSW_ONLINEDA_BASE` env for tests/MSW.

---

## 4. Node 05 — `src/agents/nodes/05_planningAndNews.ts`
`export async function fetchPlanning(state: GraphState): Promise<Partial<GraphState>>`:
- No `resolvedAddress` → in-band `PARTIAL_DATA` error (match node 06/09).
- Non-NSW region → `{ market: { suburbStats:null, recentNews:[], recentDAs:[] } }` (NSW-only v1; planning prose will note it).
- NSW: `lga = await resolveLga(lat,lng).catch(()=>null)`; `council = lga ? lgaToCouncil(lga) : null`. If `council === null` → return empty `market` (degrade; the compose/render note "planning data unavailable for this council"). Else:
  - `lodgedFrom` = today − 12 months (`YYYY-MM-DD`). **NOTE:** `new Date()` is fine in a node (not a workflow script); compute from `Date.now()`.
  - `records = await fetchRecentDAs(council, lodgedFrom)` (wrap in try/catch → on error, empty `market` + `logger.warn`, graceful degrade §7.17).
  - Map each record with valid coords to `RecentDA` (haversine distance), keep `distanceM ≤ 500`, sort by `distanceM` asc, cap to a sane top-N (e.g. 25) to bound the prose/render.
  - Return `{ market: { suburbStats:null, recentNews:[], recentDAs } }`.

---

## 5. Annotation + graph
- **`src/agents/annotation.ts`**: add a `market` channel — `Annotation<MarketContext | null>({ reducer: (_c,u)=>u, default: ()=>null })` (replacement, like `triangulation`). Import `MarketContext` from `@/schemas/state`.
- **`src/agents/graph.ts`**: `.addNode('fetchPlanning', fetchPlanning)`; `.addEdge('resolveAddress','fetchPlanning')`; extend the compose join to `.addEdge(['triangulate','fetchRisks','fetchPlanning'],'compose')`.

```
START → resolveAddress ─┬→ fetchCandidateComps → reasonAndSelect → triangulate ─┐
                        ├→ fetchRisks ──────────────────────────────────────────┤
                        └→ fetchPlanning ───────────────────────────────────────┴→ compose → render → END
```

---

## 6. Compose `planning` section + render
- **`src/prompts/compose.ts`**: add `'planning'` to `ComposeSection`; `SECTION_BRIEF.planning` ("Summarise recent development activity near the property from the DA list — the volume, notable/large applications, what it signals about the area. State plainly if no DAs were found or data was unavailable."); add `recentDAs: RecentDA[]` (or the `market`) to `ComposeInput` + into the user message; bump `version` → v1.3.
- **`src/agents/nodes/10_compose.ts`**: add `'planning'` to `SECTIONS`; feed `state.market?.recentDAs ?? []`.
- **`src/report/template/ReportDocument.tsx`**: add `recentDAs` to `ReportData`; render a "Planning activity" section — the composed prose + a compact list of the nearest DAs (distance, lodgedDate, description, status). Empty → a muted "No recent development applications found nearby / data unavailable" row. `13_render.ts` passes `state.market?.recentDAs ?? []`.

---

## 7. Testing
- **Unit (MSW for the OnlineDA host):** `onlineDa` client sends the `filters`/`PageNumber`/`PageSize` HEADERS (assert header presence + JSON shape, NOT query params), paginates on `TotalPages`, Zod-parses `Application[]`. `councils.lgaToCouncil` maps known LGAs + returns null for unknown. Node 05: maps records → RecentDA with correct haversine distance + the ≤500m filter + description synthesis; NSW-gate; council-unresolved degrade; fetch-error degrade. Use the research's sampled record shape as the fixture. Compose: 6 sections incl. `planning`. Render: a DA row + the empty/unavailable treatment.
- **Live:** extend `scripts/probe-risks.ts` (or a new `probe-planning.ts`) to call `fetchPlanning` for Mosman → expect ~36 DAs ≤500m; and a non-NSW/unmapped case.

## 8. Out of scope / follow-ups
- Council-feed free-text descriptions (richer than synthesized); adjacent-council boundary merge; `suburbStats`/`recentNews` (the other MarketContext fields); GPT-5-mini DA relevance classification (§7.7) — v1 lets the compose gpt-4.1 summarise instead; VIC.

## 9. Definition of done
- `src/tools/nsw-planning/{councils,onlineDa}.ts` + `05_planningAndNews.ts` + `market` channel + graph join + compose `planning` section + render, all unit-tested (MSW). `pnpm typecheck && pnpm lint && pnpm test` green; CLAUDE.md untouched; no new deps/creds. Live run shows recent DAs near Mosman.
