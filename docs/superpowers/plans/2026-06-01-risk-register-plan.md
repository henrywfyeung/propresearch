# Risk register (Node 09) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or executing-plans). Implement task-by-task; each task = failing test → impl → `pnpm typecheck && pnpm lint && pnpm test` green → commit. Stage only the task's named files (never `-A`, never `.env.local`/`CLAUDE.md`/`.gitignore`).

**Goal:** Add the dossier risk register (flood / bushfire / heritage) from keyless NSW ArcGIS REST services, wire Node 09 into the graph, compose a `risks` section, render it.

**Reference spec (authoritative for recipes/fields/severity):** `docs/superpowers/specs/2026-06-01-risk-register-design.md`. Read it before each task.

**Stack:** Drizzle/Zod/Vitest 2.1 + **MSW 2.6** for the ArcGIS host. `@/` → `src/`. `noUncheckedIndexedAccess` on. No new deps. Host base overridable via `NSW_ARCGIS_BASE` (default `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services`).

**Verified facts:** `RiskFlagSchema`/`RiskCategorySchema` exist (`src/schemas/state.ts`); `'risks'` is already a `SectionId` (`src/schemas/claims.ts`); the graph (`src/agents/graph.ts`) is linear `resolveAddress→fetchCandidateComps→reasonAndSelect→triangulate→compose→render`; annotation (`src/agents/annotation.ts`) has NO `risks` channel; `ReportData` (`ReportDocument.tsx`) has no `risks`.

---

## File map
| File | Action |
|---|---|
| `src/tools/nsw-risk/arcgis.ts` | Create — generic point-query + layer-name resolution |
| `src/tools/nsw-risk/bushfire.ts` | Create — `queryBushfire(lat,lng)` |
| `src/tools/nsw-risk/heritage.ts` | Create — `queryHeritage(lat,lng)` (2 layers) |
| `src/tools/nsw-risk/flood.ts` | Create — `queryFlood(lat,lng,lga?)` + coverage |
| `src/tools/nsw-risk/lga.ts` | Create — `resolveLga(lat,lng)` (best-effort; null on miss) |
| `src/agents/nodes/09_fetchRisks.ts` | Create — parallel, degrade, NSW-gate |
| `src/agents/annotation.ts` | Edit — add `risks` merge-by-key(category) channel |
| `src/agents/graph.ts` | Edit — add `fetchRisks`; `resolveAddress→fetchRisks`; `[triangulate,fetchRisks]→compose` |
| `src/prompts/compose.ts` | Edit — add `'risks'` section + brief + input; bump version |
| `src/agents/nodes/10_compose.ts` | Edit — add `'risks'` to SECTIONS; feed `state.risks` |
| `src/report/template/ReportDocument.tsx` | Edit — render risk register; add `risks` to `ReportData` |
| `src/agents/nodes/13_render.ts` | Edit — pass `state.risks` into `toReportData` |
| `tests/unit/nsw-risk-*.test.ts`, `tests/unit/fetchRisks.test.ts`, `tests/unit/compose.test.ts` (extend) | Create/Edit |

---

## Task 1 — ArcGIS client (`arcgis.ts`)
`arcgisPointQuery<T>({ service, layerName, lng, lat, outFields }, schema): Promise<T[]>` — resolve `layerName`→id via cached `GET {base}/{service}/MapServer?f=json` (match `layers[].name`), then `GET .../MapServer/{id}/query?geometry=<lng>,<lat>&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=<fields>&returnGeometry=false&f=json`. `pRetry` (retries:3, 429/5xx). Zod-parse `{ features: z.array(z.object({ attributes: schema })) }` → return `attributes[]`. Base from `NSW_ARCGIS_BASE`.
**Tests (MSW):** layer-name→id resolution (mock the MapServer introspection); query URL has the right params; parses `features[].attributes`; empty `features` → `[]`; ret/throws on persistent 5xx. Cache: second call doesn't re-introspect.

## Task 2 — Bushfire + Heritage adapters
- `queryBushfire(lat,lng): Promise<RiskFlag|null>` — layer `Fire/BFPL` name `…BFPL…`, outFields `Category,d_Category,Guideline,d_Guidelin`. Severity ← min non-zero `Category` (1→`high`,3→`medium`,2/0→`low`). `null` if no features. `sourceRef.path='/risks/bushfire'`.
- `queryHeritage(lat,lng): Promise<RiskFlag|null>` — query BOTH `HMS/Heritage` (SHR, layer name "State Heritage Register") and `Planning/EPI_Primary_Planning_Layers` ("Heritage"); SHR hit → `high`; else LEP `SIG`→severity. Merge, SHR outranks. `null` if neither hits. `path='/risks/heritage'`.
**Tests (MSW):** use the spec's sampled positive JSON → asserts severity+description+evidence; empty → null; heritage SHR-outranks-LEP when both hit. Severity table exactly per spec.

## Task 3 — Flood adapter + LGA coverage (`flood.ts`, `lga.ts`)
- `resolveLga(lat,lng): Promise<string|null>` — point query to a keyless NSW LGA-boundary layer (probe/pin a layer name during impl; if none found keyless, return null and document). 
- `queryFlood(lat,lng,lga): Promise<RiskFlag>` — layer `ePlanning/Planning_Portal_Hazard` ("Flood Planning Map"). hit→severity from `LAY_CLASS` (spec table); empty+lga∈`COVERED_FLOOD_LGAS`→`informational` "no constraint mapped"; empty+lga∉covered(or null)→`dataAvailable:false`. `COVERED_FLOOD_LGAS` = the 10 from the spec. `path='/risks/flood'`. Always returns a flag (never null).
**Tests (MSW):** hit→risk; covered-empty→informational available; uncovered-empty→dataAvailable:false; lga-null→dataAvailable:false. Never a false "no risk".

## Task 4 — Node 09 + annotation + graph
- `annotation.ts`: add `risks` channel, reducer **merge-by-key on `category`** (mirror the comparables reducer), default `[]`.
- `09_fetchRisks.ts`: NSW-gate (non-NSW → one `dataAvailable:false` flag per category); `Promise.allSettled` over bushfire/heritage/flood; per-category throw → `dataAvailable:false` degrade flag; bushfire/heritage `null` → `informational` "None identified." flag. Returns `{ risks }`.
- `graph.ts`: `.addNode('fetchRisks', fetchRisks)`, `.addEdge('resolveAddress','fetchRisks')`, change `triangulate→compose` to `.addEdge(['triangulate','fetchRisks'],'compose')`.
**Tests:** node mocks the 3 adapters → asserts merge of 3 categories, per-category degrade on throw, NSW-gate, PARTIAL_DATA when no resolvedAddress. (Graph wiring: a smoke test that `fetchRisks` is reachable + compose waits — or rely on the live run.)

## Task 5 — Compose `risks` section
- `compose.ts`: add `'risks'` to `ComposeSection`, a `SECTION_BRIEF.risks`, add `risks: RiskFlag[]` to `ComposeInput` + into the user message; bump `version`.
- `10_compose.ts`: add `'risks'` to `SECTIONS`; pass `state.risks` into the input.
**Tests:** extend `compose.test.ts` — 5 sections now; `risks` brief present; node feeds risks. Keep the `{blocks}` contract.

## Task 6 — Render risk register
- `ReportDocument.tsx`: add `risks: RiskFlag[]` to `ReportData`; render a "Risk register" section — per category: a severity chip + description; `dataAvailable:false` → muted "data unavailable" row. Place after Comparables.
- `13_render.ts`: pass `state.risks` into `toReportData`.
**Tests:** the template renders a risk row + a "data unavailable" row (HTML string assertions, mirroring existing template tests).

---

## Live validation (after Task 6)
Extend `scripts/run-report-live.ts` to print `state.risks`; run Mosman (expect bushfire/heritage "None identified", flood "data unavailable") + a known bushfire address (positive flag). Confirm the PDF shows the risk register.

## Done criteria
All files implemented + unit-tested (MSW); `pnpm typecheck && pnpm lint && pnpm test` green; CLAUDE.md untouched; no new deps/creds; live run shows a sensible risk register.
