# Design: Risk register (Node 09 `fetchRisks`) — free NSW gov data

- **Date:** 2026-06-01
- **Status:** Design (autonomous; user chose "risk register, keyless"). Endpoints live-probed 2026-06-01.
- **Scope:** Add the dossier's **risk register** — flood / bushfire / heritage — from keyless NSW government ArcGIS REST services. Wire Node 09 into the graph, add a `risks` compose section, render it in the PDF. **NSW only** (VIC risks later); noise/contamination/flightpath deferred (need Geoscape ingest).

---

## 1. Context & data sources (all live-probed, keyless)

One host, no token, CORS open, HTTPS: `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services` (NSW DCCEEW/SEED, ArcGIS 10.91). Point-intersect query shape (GET or POST):

```
{layerUrl}/query?geometry=<lng>,<lat>&geometryType=esriGeometryPoint&inSR=4326
  &spatialRel=esriSpatialRelIntersects&outFields=<fields>&returnGeometry=false&f=json
```
Empty `features[]` ⇒ no intersect. `outSR` irrelevant (`returnGeometry=false`).

| Risk | Layer | Coverage | Parse |
|---|---|---|---|
| **Bushfire** | `Fire/BFPL/MapServer/0` | **statewide**, clean | `severity` ← min non-zero `Category` across hits (`1`→`high`/critical forest, `3`→`medium`, `2`→`low` rainforest, `0`→`low` buffer/adjacency). `description` ← `d_Category`. `evidence` ← `{category, guideline:d_Guidelin}`. Empty ⇒ no flag. |
| **Heritage (State)** | `HMS/Heritage/MapServer/6` | statewide (1,823) | Any hit ⇒ `severity:'high'` (on State Heritage Register). `description` ← ``${ITEMNAME} (SHR ${LISTINGNO}, ${TYPE})``. `evidence` ← `{listing:LISTING, listingNo:LISTINGNO, type:TYPE, address:ADDRESS}`. |
| **Heritage (LEP/local + conservation areas)** | `Planning/EPI_Primary_Planning_Layers/MapServer/0` | statewide (40,426) | `severity` ← `SIG` (`State/National/World`→`high`, `Local`→`medium`). `description` ← ``${H_NAME} — ${LAY_CLASS} (${SIG}), ${EPI_NAME}``. `evidence` ← `{sig, layClass, hId:H_ID, epi:EPI_NAME}`. |
| **Flood** | `ePlanning/Planning_Portal_Hazard/MapServer/230` | ⚠️ **~11 LGAs only** | hit ⇒ `severity` from `LAY_CLASS` (`Probable Maximum Flood…`→`high`, `1 in 100 AEP`/`Flood Planning Area`→`high`, `Transitional Land`→`low`); `evidence` ← `{layClass, epi:EPI_NAME}`. **Empty is ambiguous** (see §3). |

> **Robustness:** ArcGIS numeric layer IDs move on republish; field names are stable. Pin each layer **by name** — introspect `{service}/MapServer?f=json` at module init and resolve the layer id by `name`, caching it. A `DOMAIN_SCHEMA_DRIFT`-style Sentry alert fires if a layer name can't be resolved. (v1 may hardcode the IDs above with a TODO if name-pinning balloons scope — but prefer name-pinning.)

Heritage: query **both** layers, dedupe, **SHR outranks LEP** when both hit.

---

## 2. Tool layer — `src/tools/nsw-risk/`

- **`arcgis.ts`** — `arcgisPointQuery<T>({ service, layerName, lng, lat, outFields }, schema): Promise<T[]>`. Builds the query URL against the host, `fetch` + `pRetry` (429/5xx, like `rapidApiCall`), Zod-validates `{ features: [{ attributes: ... }] }`, returns `attributes[]`. Resolves `layerName`→id via a cached `MapServer?f=json` introspection. Host overridable via `NSW_ARCGIS_BASE` env (default the URL above) for tests/MSW.
- **`bushfire.ts`** — `queryBushfire(lat, lng): Promise<RiskFlag | null>`.
- **`heritage.ts`** — `queryHeritage(lat, lng): Promise<RiskFlag | null>` (both layers, merged).
- **`flood.ts`** — `queryFlood(lat, lng, lga?: string): Promise<RiskFlag>` (always returns a flag — risk, none, or `dataAvailable:false`; see §3).

Each adapter has a strict-but-partial Zod schema (only the fields it parses) and maps to a `RiskFlag` (`src/schemas/state.ts`). `sourceRef.provider = 'overlays'`, `endpoint` = the layer URL, `path` = `/risks/<category>` (the canonical state location), `fetchedAt` = now.

---

## 3. Flood coverage disambiguation (the important bit)

An empty flood result means **either** "not flood-prone" **or** "this LGA hasn't published its LEP flood map." Returning a false "no flood risk" for an uncovered LGA (e.g., Hawkesbury) would be dangerous. Logic:

1. Resolve the subject **LGA** via a keyless NSW LGA-boundary point query (pin a layer by name at build — e.g., NSW administrative-boundaries LGA layer on the same/ös NSW Planning host; probe during implementation). Pass it into `queryFlood`.
2. `COVERED_FLOOD_LGAS` = hardcoded set (Bathurst Regional, Clarence Valley, Forbes, Hornsby, Mid-Western Regional, Tamworth Regional, Wentworth, Wingecarribee, Wollongong, Yass Valley) — with a comment that it's derived from the layer's published LGAs and may grow.
3. Flood result:
   - **hit** ⇒ `RiskFlag{category:'flood', dataAvailable:true, severity, description, evidence}`.
   - **empty + LGA ∈ covered** ⇒ `RiskFlag{flood, dataAvailable:true, severity:'informational', description:'No flood-planning constraint mapped at this address.'}`.
   - **empty + LGA ∉ covered (or LGA unresolved)** ⇒ `RiskFlag{flood, dataAvailable:false, severity:'informational', description:'NSW has not published LEP flood-planning mapping for this LGA — assess flood risk separately.'}`.

If the LGA-boundary layer can't be found keyless, fall back to the **conservative** branch for every empty (always `dataAvailable:false` on empty) — never a false "no risk." Document whichever path ships.

---

## 4. Node 09 — `src/agents/nodes/09_fetchRisks.ts`

- Inputs: `state.resolvedAddress.{lat,lng,state}`. If `state !== 'NSW'` ⇒ return one informational `RiskFlag` per category with `dataAvailable:false`, description "Risk data sources are NSW-only in v1" (VIC later). If no `resolvedAddress` ⇒ in-band `PARTIAL_DATA` error.
- Run bushfire / heritage / flood **in parallel** (`Promise.allSettled`). Per-category failure ⇒ `RiskFlag{category, dataAvailable:false, severity:'informational', description:'Risk data unavailable (source error).', sourceRef:null, evidence:null}` (§7.17 graceful degrade; log a `PartialDataError` breadcrumb). A null from bushfire/heritage (no intersect) ⇒ a `dataAvailable:true, severity:'informational', description:'None identified.'` flag so the report explicitly says "no heritage/bushfire constraint found" rather than omitting it.
- Returns `{ risks: RiskFlag[] }` (one per category: flood, bushfire, heritage).

> Per-item idempotency (`report_node_artifacts`, [R21]) is **out of scope for v1** (no Inngest/checkpointer yet); add when the durable queue lands.

---

## 5. Graph wiring + annotation

- **`src/agents/annotation.ts`**: add a `risks` channel — **merge-by-key on `category`** reducer (§6.1), default `[]`.
- **`src/agents/graph.ts`**: add node `fetchRisks`; edges `resolveAddress → fetchRisks` (parallel with `fetchCandidateComps`) and change `triangulate → compose` to **`[triangulate, fetchRisks] → compose`** (join — compose waits for both). `runGraph`'s `onNode` (if/when added) covers it automatically.

```
START → resolveAddress ─┬→ fetchCandidateComps → reasonAndSelect → triangulate ─┐
                        └→ fetchRisks ───────────────────────────────────────────┴→ compose → render → END
```

---

## 6. Compose section + render

- **`src/prompts/compose.ts`**: add `'risks'` to `ComposeSection` (the `SectionId` already includes it in `claims.ts`). Add a `SECTION_BRIEF.risks` ("Summarise the risk register: which constraints apply (flood/bushfire/heritage), their severity, and what each means for a buyer. State plainly when a category found nothing or data was unavailable."). Pass `risks` into `ComposeInput`. Bump `version`.
- **`src/agents/nodes/10_compose.ts`**: include `'risks'` in `SECTIONS`; feed `state.risks` into the input. (Text-blocks output, same `{blocks}` shape.)
- **`src/report/template/ReportDocument.tsx`**: render a "Risk register" section — a compact list of `RiskFlag`s (category, severity chip, description), with `dataAvailable:false` rendered as a muted "data unavailable" row (§7.17). Place after Comparables (or wherever reads well). Add `risks` to `ReportData`.

---

## 7. Testing
- **Unit (MSW for the ArcGIS host):** `arcgisPointQuery` builds the right URL + parses `features[].attributes`; each adapter maps a sampled positive response → the right `RiskFlag` severity, and an empty response → null (bushfire/heritage) / the right flood branch. Flood: covered-LGA-empty vs uncovered-LGA-empty vs hit. Node 09: parallel, per-category degrade on a thrown adapter, NSW-gate for non-NSW, merges all three categories. Use the **real sampled JSON** from the research as fixtures.
- **Manual (live):** extend `scripts/run-report-live.ts` to print `state.risks`; run against Mosman (expect bushfire/heritage "none identified", flood "data unavailable") and a known bushfire/heritage address (expect positive flags).

## 8. Out of scope / follow-ups
- VIC risk sources; noise/contamination/flightpath (Geoscape); per-item idempotency; name-pinning hardening if deferred; the LGA-layer for flood if a clean keyless one isn't found (ship conservative).

## 9. Definition of done
- `src/tools/nsw-risk/{arcgis,bushfire,heritage,flood}.ts` + `09_fetchRisks.ts` + annotation `risks` channel + graph join + compose `risks` section + PDF render, all implemented & unit-tested (MSW).
- `pnpm typecheck && pnpm lint && pnpm test` green; CLAUDE.md untouched; no new deps; no new credentials.
- Live run shows a sensible risk register for Mosman + a positive-risk address.
