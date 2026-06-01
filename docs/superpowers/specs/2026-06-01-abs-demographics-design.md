# Design: ABS suburb demographics (Node fetchDemographics)

- **Date:** 2026-06-01
- **Status:** Design (autonomous; "keep going creds-free"). All endpoints live-probed 2026-06-01, keyless, national (CC-compatible ABS open data → fits §4.3).
- **Scope:** Enrich the dossier's **market** section with ABS Census-2021 demographics for the property's SA2 (population, median age, household income, rent/mortgage, household size, owner/renter tenure). New `demographics` graph channel + node, fed into the compose `market` section + rendered. Works NSW + VIC (national).

## 1. Data path (live-probed, keyless)
**Step 1 — point → SA2** (Esri ArcGIS, **lng,lat / X,Y order** — opposite of the VIC WFS!):
```
GET https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/SA2/MapServer/0/query
  ?geometry={lng},{lat}&geometryType=esriGeometryPoint&inSR=4326
  &spatialRel=esriSpatialRelIntersects
  &outFields=SA2_CODE_2021,SA2_NAME_2021,SA3_NAME_2021,STATE_NAME_2021
  &returnGeometry=false&f=json
→ features[0].attributes.{sa2_code_2021, sa2_name_2021, ...}
```
**Step 2a — SA2 → medians (ABS Data API, SDMX-CSV — host is `data.api.abs.gov.au/rest/`):**
```
GET https://data.api.abs.gov.au/rest/data/ABS,C21_G02_SA2,1.0.0/.{SA2}.SA2.?dimensionAtObservation=AllDimensions
  Accept: application/vnd.sdmx.data+csv
→ flat CSV rows; column MEDAVG (code) + OBS_VALUE. Map MEDAVG:
   1=medianAge, 2=medianPersonalIncomeWeekly, 4=medianHouseholdIncomeWeekly,
   5=medianMortgageMonthly (⚠ MONTHLY), 6=medianRentWeekly, 8=avgHouseholdSize
```
**Step 2b — SA2 → population + tenure (ABS Census ArcGIS FeatureServers, keyless):**
```
host = https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services
GET {host}/ABS_2021_Census_G01_SA2/FeatureServer/0/query?where=SA2_CODE_2021='{SA2}'&outFields=Tot_P_P,Tot_P_M,Tot_P_F&returnGeometry=false&f=json  → population
GET {host}/ABS_2021_Census_G37_SA2/FeatureServer/0/query?where=SA2_CODE_2021='{SA2}'&outFields=O_OR_Total,O_MTG_Total,R_Tot_Total,Total_Total&returnGeometry=false&f=json
   → ownerOccupiedPct = (O_OR_Total+O_MTG_Total)/Total_Total*100; rentedPct = R_Tot_Total/Total_Total*100
```
**Gotchas:** SA2 query is **lng,lat** (X,Y) — NOT lat,lng. SDMX host is `data.api.abs.gov.au/rest/` (the old `api.data.abs.gov.au` 301-redirects). Use the CSV accept header (avoids SDMX-JSON positional decoding). rent=weekly, mortgage=monthly. Cache permanently (static 2021 Census). All steps must **degrade gracefully** to null (the data is enrichment, never required).

## 2. Schema + channel
- **`src/schemas/state.ts`** — `SuburbDemographicsSchema` = `z.object({ sa2Code: z.string(), sa2Name: z.string(), population: z.number().nullable(), medianAge: z.number().nullable(), medianHouseholdIncomeWeekly: z.number().nullable(), medianPersonalIncomeWeekly: z.number().nullable(), medianRentWeekly: z.number().nullable(), medianMortgageMonthly: z.number().nullable(), avgHouseholdSize: z.number().nullable(), ownerOccupiedPct: z.number().nullable(), rentedPct: z.number().nullable(), censusYear: z.number() })`. Export the type. Add `demographics: SuburbDemographicsSchema.nullable()` to `ReportStateSchema`.
- **`src/agents/annotation.ts`** — `demographics` channel, replacement reducer `(_c,u)=>u`, default null.

## 3. Tool layer — `src/tools/abs/`
- **`sa2.ts`** — `resolveSa2(lat,lng): Promise<{ sa2Code: string; sa2Name: string } | null>` (Esri ArcGIS, lng,lat order; mirror `@/tools/nsw-risk/arcgis.ts` fetch+pRetry+Zod; null on no hit/error). Base from `ABS_ASGS_BASE` env (default the geo.abs.gov.au URL).
- **`census.ts`** — `fetchCensusDemographics(sa2Code): Promise<Partial<SuburbDemographics>>` — the 3 calls (SDMX-CSV medians + G01 population + G37 tenure) in parallel (`Promise.allSettled`); each may individually fail → omit its fields. Parse the SDMX CSV (split lines, map MEDAVG→value). Hosts from `ABS_DATA_API_BASE` / `ABS_CENSUS_ARCGIS_BASE` env (defaults). Returns whatever succeeded.

## 4. Node — `src/agents/nodes/12_fetchDemographics.ts` (id `fetchDemographics`)
`fetchDemographics(state)`: no `resolvedAddress` → in-band PARTIAL_DATA (match node 09). Else `resolveSa2(lat,lng)`; null → `{ demographics: null }` (graceful). Else `census = await fetchCensusDemographics(sa2Code)` (wrap in try/catch → null) → `{ demographics: { sa2Code, sa2Name, censusYear: 2021, ...census } }`. National (no state gate — ABS is Australia-wide).

## 5. Graph
`.addNode('fetchDemographics', fetchDemographics)`; `.addEdge('resolveAddress','fetchDemographics')`; extend the compose join to `['triangulate','fetchRisks','fetchPlanning','fetchDemographics']`.

## 6. Compose + render
- **`src/prompts/compose.ts`**: add `demographics: SuburbDemographics | null` to `ComposeInput` + include in the `market` buildMessages user message (the `market` SECTION_BRIEF already covers "suburb market"; extend it to weave in demographic context — income/age/tenure — when present). Bump `version` → v1.5.
- **`src/agents/nodes/10_compose.ts`**: feed `state.demographics` into the input.
- **`src/report/template/ReportDocument.tsx`** + `toReportData.ts`: add `demographics` to `ReportData`; render a compact demographics block within the "Suburb market" section (population, median age, median household income $/wk, owner-occupied %, median rent $/wk). Null → omit. Note rent weekly / mortgage monthly in labels.

## 7. Testing
- **Unit (MSW):** `resolveSa2` builds the lng,lat geometry + parses the SA2; `fetchCensusDemographics` parses the SDMX CSV (MEDAVG mapping) + the G01/G37 ArcGIS + computes tenure %; each sub-call failing degrades to omitted fields (not a throw). Node: null SA2 → null demographics; PARTIAL_DATA guard; happy path. Use the research's REAL sample rows (Mosman SA2 121041688) as fixtures.
- **Live:** extend a probe (`scripts/probe-demographics.ts`) → Mosman + Richmond → expect the real values.

## 8. Definition of done
- `src/tools/abs/{sa2,census}.ts` + `12_fetchDemographics.ts` + `demographics` channel + graph join + compose-market + render, unit-tested (MSW). `pnpm typecheck && pnpm lint && pnpm test` green; CLAUDE.md untouched; no new deps/creds. Live probe shows real demographics for Mosman + a VIC point.
