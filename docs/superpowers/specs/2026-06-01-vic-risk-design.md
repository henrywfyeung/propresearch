# Design: VIC risk register (+ VIC planning degrade)

- **Date:** 2026-06-01
- **Status:** Design (autonomous; user: "keep going with everything creds-free"). WFS live-probed 2026-06-01.
- **Scope:** Make **Node 09 (risks)** functional for **Victoria** via the keyless DEECA Vicmap GeoServer WFS (flood / bushfire / heritage, statewide point-query). Branch the node by `resolvedAddress.state`. **VIC planning (Node 05) has NO clean statewide keyless feed** (council-fragmented) → keep the degrade path with a VIC-specific message. Comps/valuation/geocoding/market already work nationally, so this unlocks VIC risk dossiers.

## 1. Data source (live-probed, keyless)
**`https://opendata.maps.vic.gov.au/geoserver/wfs`** (namespace `open-data-platform`). WFS 2.0.0, `outputFormat=application/json`. Keyless, CORS `*`, statewide.

**CRITICAL axis gotcha:** the filter is `INTERSECTS(geom, POINT(<lat> <lng>))` — **lat THEN lng** (Y X), with **no `srsName`** (or `srsName=urn:ogc:def:crs:EPSG::4326`). The usual lng-lat order silently returns 0 features (HTTP 200). Also always pass `propertyName=<fields>` (no geom) or responses balloon to multi-MB polygons. A bad `propertyName` field → an **XML ServiceException, not JSON** → parse defensively.

Canonical request (GET, url-encoded):
```
service=WFS&version=2.0.0&request=GetFeature&typeNames=<typeName>&outputFormat=application/json
&propertyName=<fields>&CQL_FILTER=INTERSECTS(geom, POINT(<lat> <lng>))[ AND <extra>]
```
Empty `features[]` / `numberMatched:0` ⇒ no intersect (NOT missing data → `dataAvailable:true`).

| Category | typeName | CQL extra | Fields | Severity |
|---|---|---|---|---|
| **flood** | `open-data-platform:plan_overlay` | `scheme_code IN ('LSIO','FO','SBO')` | `scheme_code, zone_code, zone_description, lga, gaz_begin_date` | `FO`→high, `LSIO`/`SBO`→medium |
| **bushfire (BMO)** | `open-data-platform:plan_overlay` | `scheme_code='BMO'` | same | high |
| **bushfire (BPA)** | `open-data-platform:bushfire_prone_area` | — | `lga_name, plan_number, gazettal_date` | medium |
| **heritage (HO)** | `open-data-platform:plan_overlay` | `scheme_code='HO'` | `scheme_code, zone_code, zone_description, lga` | medium |
| **heritage (VHR)** | `open-data-platform:heritage_register` | — | `vhr_num, site_name, hermes_num` | high |

## 2. Tool layer — `src/tools/vic-risk/`
- **`wfs.ts`** — `vicWfsPointQuery<T>({ typeName, lat, lng, propertyName, cqlExtra? }, schema): Promise<T[]>`: build the canonical request (POINT lat-lng order!), `fetch` + `pRetry` (429/5xx, mirror `@/tools/nsw-risk/arcgis.ts`), Zod-validate `{ features: [{ properties: <schema> }] }` → return `properties[]`. **Guard the XML-error case** (if the body isn't JSON / parse fails → `SchemaDriftError`). Base from `VIC_VICMAP_WFS` env (default the URL).
- **`flood.ts`** — `queryVicFlood(lat,lng): Promise<RiskFlag | null>` (plan_overlay, flood scheme_codes; most-severe wins; `null` if none). `sourceRef.provider='overlays'`, `path='/risks/flood'`.
- **`bushfire.ts`** — `queryVicBushfire(lat,lng): Promise<RiskFlag | null>` — query BMO (plan_overlay) AND bushfire_prone_area in parallel; merge into ONE flag: severity `high` if BMO present else `medium` if BPA; `null` if neither. evidence merges both.
- **`heritage.ts`** — `queryVicHeritage(lat,lng): Promise<RiskFlag | null>` — HO (plan_overlay) + heritage_register (VHR) in parallel; VHR (high) outranks HO (medium); merge evidence (HO `zone_code` schedule; VHR `vhr_num`+`hermes_num`); `null` if neither.

Each adapter: strict-but-partial Zod over the fields it uses; map → `RiskFlag` (`src/schemas/state.ts`). Mirror the NSW adapters' style (`src/tools/nsw-risk/{bushfire,heritage}.ts`).

## 3. Node 09 branch — `src/agents/nodes/09_fetchRisks.ts`
Replace the NSW-only gate with a branch on `resolvedAddress.state`:
- `'NSW'` → existing path (resolveLga + queryBushfire/queryHeritage/queryFlood).
- `'VIC'` → `Promise.allSettled([queryVicBushfire, queryVicHeritage, queryVicFlood])` (no LGA / no flood-coverage gap — the VIC WFS is statewide point-query). Same result mapping: null → `noneFlag`, throw → `degradeFlag`. (Reuse the existing `noneFlag`/`degradeFlag` helpers.)
- else (`'WA'`/other) → the existing `dataAvailable:false` "not available in v1" flags (rename the helper message from "NSW-only" → "Risk data sources cover NSW and VIC in v1").
Keep the merge-by-key(category) return + graceful degrade. The per-category helpers + the parallel/allSettled structure are shared; only the adapter set differs by state.

## 4. VIC planning (Node 05) — degrade (no build)
There is **no free statewide keyless point-queryable planning-permit feed** for VIC (verified — only a couple of councils publish geocoded registers). So Node 05 keeps returning an empty `market` for VIC, but improve the message: for a VIC `resolvedAddress`, the degraded `recentDAs:[]` should compose/render as "No free statewide planning-permit feed is available for Victoria (council-fragmented); not assessed." Implement minimally: the planning node already returns empty `market` for non-NSW — just ensure the compose `planning` brief + render handle the empty case gracefully (they already do). Optionally tag the VIC case so the prose says "Victoria" specifically. (Per-council VIC DA adapters — e.g. City of Melbourne OpenDataSoft — are a future follow-up.)

## 5. Testing
- **Unit (MSW for the Vicmap WFS host):** `vicWfsPointQuery` builds the lat-lng `POINT()` filter + `propertyName`, parses `features[].properties`, empty→[], XML-error→SchemaDriftError. Each adapter maps a sampled positive response (use the research's real samples: Maribyrnong LSIO, Dandenong BMO, Fitzroy HO, Royal Exhibition VHR) → the right RiskFlag severity; empty→null; bushfire BMO-vs-BPA severity; heritage VHR-outranks-HO. Node 09: VIC branch merges 3 categories + degrades per-category; the `state` branch (NSW vs VIC vs other).
- **Live:** extend `scripts/probe-risks.ts` (or a `probe-vic-risks.ts`) with VIC points (Maribyrnong flood, Dandenong bushfire, Fitzroy heritage) → expect the right flags.

## 6. Definition of done
- `src/tools/vic-risk/{wfs,flood,bushfire,heritage}.ts` + the Node 09 state-branch, unit-tested (MSW). `pnpm typecheck && pnpm lint && pnpm test` green; CLAUDE.md untouched; no new deps/creds. Live probe shows VIC risk flags for Melbourne-area points. (VIC planning stays degraded; per-council DA adapters deferred.)
