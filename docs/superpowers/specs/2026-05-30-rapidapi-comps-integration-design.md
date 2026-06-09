# Design: RapidAPI comp source (REA-primary) for Node 03

- **Date:** 2026-05-30
- **Status:** Draft for review
- **Scope decision:** Comps-only (smallest change that captures the value)
- **Supersedes for the comp path:** the "NSW-VG-only Tier-2 comps" posture of the v2 pivot, and the in-progress official-Domain OAuth client (`src/tools/domain/*`).

---

## 1. Context & decision

The v2 pivot (CLAUDE.md banner, §4.3) removed Domain because its **official API
T&Cs** are incompatible with an LLM pipeline, leaving comps to **NSW VG only**
(price + date, but no attributes or photos) for NSW and **suburb-median context
only** for VIC. That is thin: no per-comp photos (so Node 04b comp-vision is
dead), and nothing per-property for VIC.

The owner asked to evaluate two RapidAPI sources to restore richer comp data.
Both were probed live (2026-05-30) with the owner's key. Findings drove the
**comps-only** scope: use the RapidAPI sold-listings feed as the **candidate-comp
source for Node 03** and re-enable **Node 04b comp-vision**, while leaving the
**subject property human-in-the-loop** (per v2) and adding **no AVM / rentals /
market context** in this iteration.

**This decision is explicitly for a single-user personal-research tool.** It is
not a step back toward a multi-user or commercial product; see §2.

## 2. Legal / risk posture (accepted, documented — not hand-waved)

Both APIs are **third-party proxies over the consumer portals' own internal
APIs** (proven from the payloads, not inferred):

- `domain-au` returns Domain GraphQL types (`SearchListingsResultListing`,
  `PriceDetails`) and photos on `rimh2.domainstatic.com.au` → **Domain.com.au**.
- `realty-base-au` uses REA's `atlasId` location scheme and `_links` to
  `realestate.com.au` / `i3.au.reastatic.net` / `investor-api.realestate.com.au`
  → **realestate.com.au (REA)**.

So the §4.3 concerns are **not** eliminated by going through RapidAPI; they
change shape (contract → copyright/provenance):

- The listing **photos and descriptions are REA's / the agents' copyright**,
  obtained by an unauthorized scraper that cannot license them to us. Feeding
  them to US LLMs + storing them + emitting a derivative PDF re-introduces the
  copyright/derivative exposure §4.3 flagged.
- We become a **downstream user of the proxy's ToS breach** of the portal
  (contributory/provenance risk), and the proxies are liable to be
  Akamai-blocked and **vanish without notice**.

**The owner has accepted this risk for personal, single-user use.** Guardrails
that keep the decision conscious and contained:

1. **Single user, personal research only.** Not to be exposed to additional
   users or commercialized without re-opening this analysis.
2. **Degradable, never load-bearing (§5.5).** The pipeline must downgrade to the
   open-data baseline (NSW VG / VIC VPSR) when the proxy is unavailable, so we
   can pull the source at any time without breaking report generation.
3. **No re-hosting of imagery.** Photo URLs are passed to the vision model and
   the PDF **by URL** (CDN fetch), never copied into R2 — same posture as the
   old §8.3 note.
4. **PII/residency** unchanged from §4.3 item 6 — Sentry/Langfuse scrubbing
   (§14.1) still applies to addresses + listing content.

## 3. The two sources (evidence-based, 2026-05-30)

Both are **search-only** (no per-address / per-listing detail endpoint exists —
13 candidate detail paths probed, all gateway-404). Both auth via RapidAPI
`X-RapidAPI-Key` + `X-RapidAPI-Host` headers.

| | `domain-au` (Domain) | `realty-base-au` (REA) — **primary** |
|---|---|---|
| Host | `domain-au.p.rapidapi.com` | `realty-base-au.p.rapidapi.com` |
| Autocomplete | `GET /properties/auto-complete?query=` → `id:"suburb:Mosman-NSW-2088"` | `GET /auto-complete?query=` → `locationId:"suburb:Mosman, NSW 2088"` (+ atlasId) |
| Search | `GET /properties/search?id=<suburb:..>&channel=sold&page=N` (20/pg) | `GET /properties/search?locationId=<..>&channel=sold&page=N` (25/pg) |
| Sold volume (Mosman) | 14,549 | 33,114 |
| **Sold date** | ⚠️ free text in `propertyLabels[].label` ("Sold … 25 Oct 2011") | ✅ structured `dateSold.value` = `"2026-05-26"` |
| **Sold price** | ⚠️ frequently `"Price Withheld"` | ✅ `price.display` = `"$1,030,000"` — **25/25 disclosed** in sample |
| Sort | not recency (2011 on page 1) | ✅ **recency-first** |
| Geo | lat/lng present | ✅ `address.location.{latitude,longitude}` |
| Land | `landArea` | ✅ `landSize.{value:787,unit:"m2"}` |
| Photos | `media[]` (domainstatic) | ✅ `mainImage` + `images[]` (10), reastatic |
| Description | not in search | ✅ `description`, `title` |

**Conclusion: REA (`realty-base-au`) is the source.** Structured `dateSold` +
`price`, recency-first, 100% disclosure in sample, plus lat/lng, land size,
attributes, and 10 photos per listing — everything Node 03 scoring and Node 04b
vision need.

**`domain-au` is dropped** (owner-confirmed 2026-05-30; see §8): its sold data is
materially weaker (date only parseable from label prose, price often withheld, no
recency sort), so it is a poor cross-check. The **authoritative cross-check is
NSW VG** (government settlement record), which we already ingest.

## 4. Field mapping — REA search(sold) → `ComparableSchema`

Target type: `src/schemas/state.ts` `ComparableSchema`.

| `Comparable` field | REA source | Transform |
|---|---|---|
| `id` | `listingId` | `String(...)` |
| `address` | `address.streetAddress` + `locality`/`state`/`postcode` | join |
| `salePrice` | `price.display` `"$1,030,000"` | strip `$`,`,` → number. **Reject comp if not a single positive number** (withheld / range) — `salePrice` is `.positive()` required |
| `contractDate` | `dateSold.value` `"2026-05-26"` | already ISO |
| `distanceM` | `address.location.{latitude,longitude}` vs subject lat/lng (`resolvedAddress`) | Haversine |
| `beds`/`baths`/`parking` | `features.general.{bedrooms,bathrooms,parkingSpaces}` | as-is |
| `landArea` | `landSize.{value,unit}` | m² (convert if `unit!="m2"`); null if absent |
| `propertyType` | `propertyType` `"apartment"` | map REA vocab → subject's vocab (Q4) |
| `photos` | `images[].{server,uri}` | `server+uri`; cap (e.g. 8) for vision cost |
| `source` | — | `SourceRef{ provider:'rea', endpoint:'/properties/search?channel=sold', fetchedAt, path:'/comparables/<i>/salePrice' }` |
| `visionAnalysis` | — | null at fetch; filled by Node 04b |
| `similarityScore`/`selection`/`adjustments`/`adjustedValue`/`adjustmentNarrative` | — | set by Node 03 scoring / Node 06 |

## 5. Architecture

### 5.1 New tool layer `src/tools/rapidapi/`
- `client.ts` — `rapidApiCall<T>(host, path, params, schema, opts)`: `X-RapidAPI-Key`/`Host`
  headers; `pRetry` on 429/5xx (mirror existing `src/tools/domain/client.ts`);
  Zod-validate → `SchemaDriftError` on mismatch; per-report call counting +
  ceiling via `reportCtx` AsyncLocalStorage (mirror `DOMAIN_CALLS_PER_REPORT`
  with `RAPIDAPI_CALLS_PER_REPORT`).
- `reaBase.ts` — `reaAutoComplete(query)`, `reaSearchSold(locationId, {page})`;
  normalizer `toComparable(reaListing, subjectGeo): Comparable | null`
  (null = unusable, e.g. withheld price).
- Zod schemas for the REA responses live beside the adapter (validated at the
  boundary, then discarded in favor of `Comparable`).

### 5.2 Retire the official-Domain OAuth client
`src/tools/domain/client.ts` + `auth.ts` (OAuth bearer to `api.domain.com.au`)
are the **wrong** client for RapidAPI and are not otherwise used. **Remove them**
(they are uncommitted local work — confirm with owner before deleting, Q3).

### 5.3 Schema change — `src/schemas/sources.ts`
Add to `ProviderSchema`: `'rea'`, and `'rea+nsw-vg'` (merged comp after the NSW
VG price reconciliation, mirroring the existing `'domain+nsw-vg'` [R40] pattern).
The legacy `'domain'` / `'domain+nsw-vg'` values are removed once the OAuth
client and any remaining references to them are gone (Q3).

### 5.4 Node 03 `fetchCandidateComps` rewiring
1. Resolve subject suburb → REA `locationId` (via `reaAutoComplete`, or build
   `suburb:<Suburb>, <STATE> <PC>` from `resolvedAddress`).
2. `reaSearchSold(locationId)` for the first K pages (K≈3 → ~75 candidates),
   `toComparable`, drop nulls and anything outside the **180-day window**
   (`contractDate`) — trivial since results are recency-first.
3. **NSW only:** reconcile each comp's `salePrice`/`contractDate` against
   `nsw_vg_sales` (PostGIS match on geo + `±1 day`): prefer **NSW VG price**
   (authoritative settlement) when both exist; mark `provider:'rea+nsw-vg'`.
   **VIC:** no per-property gov record exists → REA stands alone; provenance
   `provider:'rea'`; VPSR remains suburb-median context only.
4. Run the existing §7.3 similarity scoring; keep top 30.

### 5.5 Degradation ladder (§7.17 extension)
`REA available` → comps from REA (+ NSW-VG reconciliation where applicable).
`REA down / blocked / schema-drift` → **fall back to the open-data baseline**:
NSW = `nsw_vg_sales` Tier-2 comps (no photos → Node 04b skipped); VIC = VPSR
median context only. PDF carries a provenance note. This is what keeps the
proxy non-load-bearing (§2 guardrail 2).

### 5.6 Node 04b `visionAnalyseComps`
No code change beyond data availability: comps now carry `photos[]`, so
comp-vision runs (was effectively dead under NSW-VG-only). Per-comp idempotency
(`report_node_artifacts`) and `p-limit(6)` unchanged.

## 6. Cost & quota (resolved 2026-05-30)
Owner-confirmed Pro tiers:
- **REA `realty-base-au` Pro** — $15/mo, **17,000 req/mo** (+$0.01/req over),
  **5 req/s**, 10 GB bandwidth (+$0.001/MB over).
- **`domain-au` Pro** — $15/mo, **23,000 req/mo** (+$0.008/req), 5 req/s, 10 GB.
- Budget approved **~$30/mo** (both Pro). At personal volume this is a
  non-constraint, not just affordable.

Headroom check (worst case = `DAILY_LIMIT` 20 reports/day ≈ 600/mo):
- ~4 REA calls/report → **~2,400 calls/mo** = ~14% of REA's 17k. **No overage path.**
- ~150 KB/call → **~0.36 GB/mo** = ~4% of the 10 GB allowance.
- Per report: 1 autocomplete + ~3 sold pages = **~4 calls**.

Settings:
- `RAPIDAPI_CALLS_PER_REPORT = 30` (generous; real usage ~4) — ceiling enforced
  via `reportCtx`, mirroring `DOMAIN_CALLS_PER_REPORT`.
- **5 req/s rate limit** → Node 03 page fetches sequential or `p-limit(≤4)`;
  never collides with Node 04b vision (those are OpenAI calls, not RapidAPI).
- LLM cost unchanged except Node 04b comp-vision returns to the §11.3 budget
  (~$0.60 typical) now that comps have photos.
- Env: `RAPIDAPI_KEY`, `RAPIDAPI_REA_HOST=realty-base-au.p.rapidapi.com`
  (+ `RAPIDAPI_DOMAIN_HOST=domain-au.p.rapidapi.com` only if domain-au is wired).

## 7. Failure modes
- **Proxy vanishes / Akamai-block / 4xx:** non-retryable → degrade per §5.5.
- **Schema drift** (proxy changes shape): Zod fail → `SchemaDriftError` → §14.4
  alert → degrade. Proxies are *more* drift-prone than first-party APIs; the
  degrade path is mandatory, not optional.
- **Withheld/range price:** `toComparable` returns null; comp excluded.
- **Subject not on-market:** unchanged from v2 — subject stays user-supplied;
  this design does not fetch the subject.

## 8. Out of scope (explicitly deferred)
- `domain-au` integration (weak sold data — Q2).
- Rentals (`channel=rent`) → Node 08 / triangulation rental weight.
- REA `_links.marketInfo` → Node 10 market context.
- Subject auto-match from suburb for-sale results.
- AVM (neither source provides one; comp-derived remains the valuation).

## 9. Open questions
- **Q1. (resolved — §6)** Pro tiers, ~$30/mo, ample headroom.
- **Q2. (resolved — owner OK 2026-05-30)** **Drop `domain-au`.** The pipeline
  relies on **REA + NSW VG** only. (Keeping/cancelling the domain-au subscription
  is the owner's choice; the design does not use it.)
- **Q3. (resolved — owner OK)** **Commit** the uncommitted
  `src/tools/domain/{client,auth}.ts` first (recoverable in history), then remove
  during implementation.
- **Q4.** REA `propertyType` vocabulary → our `propertyType` mapping (affects the
  §7.3 propertyType term and subject-vs-comp comparison). Enumerate from live data.
- **Q5.** Photo cap per comp for vision cost (default 8)?

## 10. Definition of done
- `src/tools/rapidapi/` with Zod-validated REA adapter + `toComparable`, unit-tested
  (incl. withheld-price → null, land-unit conversion, Haversine distance).
- `ProviderSchema` extended; type-checks pass.
- Node 03 sources REA candidates (NSW-VG-reconciled on NSW), degrades to open-data
  baseline on REA failure (integration test simulating REA 4xx).
- Node 04b comp-vision exercised on a comp with photos.
- Risk posture (§2) reflected in CLAUDE.md (supersede the "NSW-VG-only comps"
  text for NSW/VIC; document the accepted personal-use risk).
