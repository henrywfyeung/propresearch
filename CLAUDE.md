# CLAUDE.md — AI Property Due-Diligence Platform

> **Audience:** Claude Code (and any future contributor). This file is the
> ground-truth project context for the *buyers-agent-tool* monorepo. It is a
> restructured version of `engineering_spec_refined.docx` (v1.1), kept in the
> repo so it stays under version control and is read on every Claude Code
> session start.
>
> Where the spec carried `[Refinement]` / `[Rxx]` notes, they are retained
> in-line so the rationale for non-obvious choices isn't lost.

---

## 0. Project overview

A web-only internal tool used by **three named buyer's agents** to produce
**6–10 page professionally-rendered PDF due-diligence reports** for Australian
residential properties.

- **Input:** an Australian residential property address
- **Output:** a PDF dossier covering subject property, AVM-derived value range,
  6–8 selected comparable sales (with vision-augmented adjustment reasoning),
  rental evidence, suburb market context, risk register (flood / bushfire /
  heritage / noise / planning / market), and a negotiation evidence pack
  (signals, suggested opening offer, walk-away price).
- **Latency budget:** ≤ 5 min / report. **Quality is the optimisation
  target, not speed.**
- **Geographic phasing:** Phase 1 Sydney metro (NSW); Phase 2 Melbourne (VIC);
  Phase 3 Perth (WA). Non-Phase-1 addresses return `UnsupportedRegionError`.

---

## 1. Scope & success criteria

### 1.1 In scope
The full pipeline above: address resolution, Domain + NSW VG data ingestion,
GPT-5 vision over listing photos and Street View, comp selection and
adjustment reasoning, value triangulation, structured-claim composition,
deterministic + LLM critic, PDF rendering, R2 upload, signed-URL delivery,
email notification, audit logging.

### 1.2 Users & access
- Three named users (founding buyer's-agent group)
- **Google OAuth via Supabase Auth**, gated by an **email allow-list**
- Single shared brand (firm-level) — no per-user branding
- Web-only, modern desktop browsers (Chrome / Edge / Safari)

### 1.3 Geographic scope (Phase 1 detail)
- **Phase 1 — Sydney metro (NSW).** Only LGAs whose council DA feeds are
  supported (see §7.7) are in scope at **full feature parity**. Other Sydney
  LGAs may be processed in **degraded mode** (no council-DA layer; planning
  prose carries reduced-confidence language).
- **Phase 2 — Melbourne metro (VIC)**
- **Phase 3 — Perth metro (WA)**

`[R10]` Original spec implied full Sydney-metro coverage but only listed 4
council DA feeds. Phase 1 is now explicitly the LGAs we can serve at parity,
with a defined degraded mode for others.

### 1.4 Definition of done (per feature)
- Type-safe end to end; Zod schemas validated at every external boundary
- Every numeric claim in the rendered PDF traces to a `SourceRef` in the
  state object via the structured-claim format (§7.12)
- Critic agent has approved (or `MAX_REVISIONS` exhausted)
- No unhandled exceptions in Sentry on the happy path
- Langfuse trace exists for every LLM call with prompt / model / tokens / cost
- Audit-log row exists for every report generation
- Per-node and per-report cost stay inside the budgets in §11

### 1.5 Out of scope
- Marketing site, sign-up flow, billing, multi-tenancy
- Native mobile
- Custom AVM model training
- Real-time collaboration
- CRM integration
- **Scraping of any proprietary listing portal (Domain, REA, etc.).**
  Public-data ingestions (NSW VG ZIPs, council DA JSON feeds, NSW SES / RFS
  WFS) **are** in scope but are schema-fragile and treated as such.

> `[Edit]` The out-of-scope clause bans proprietary-portal scraping, not
> public-data ingestion (which we depend on).

---

## 2. Stack & version pins

### 2.1 Runtime
- Node.js **24.x LTS** (krypton)
- pnpm **9.x**
- ES2022, `module=esnext` (drizzle-kit's bundled esbuild rejects ES2023; ES2022 covers everything we use)
- TypeScript **5.6.x**, `strict: true`, `noUncheckedIndexedAccess: true`

### 2.2 Production dependencies (exact-pinned, no ranges, no `latest`)
Renovate auto-PRs upgrades behind CI. `[R9]`

| Package | Version |
|---|---|
| next | 15.0.3 |
| react / react-dom | 19.0.0 |
| @langchain/langgraph | 0.2.34 |
| @langchain/core | 0.3.18 |
| @langchain/openai | 0.3.14 |
| @langchain/anthropic | 0.3.7 |
| @langchain/langgraph-checkpoint-postgres | 0.0.4 |
| ai | 4.0.3 |
| @ai-sdk/openai | 1.0.5 |
| zod | 3.23.8 |
| ts-pattern | 5.5.0 |
| date-fns | 4.1.0 |
| p-retry | 6.2.0 |
| p-limit | 6.1.0 |
| drizzle-orm | 0.36.4 |
| postgres | 3.4.5 |
| inngest | 3.27.4 |
| @supabase/supabase-js | 2.45.6 |
| @supabase/ssr | 0.5.2 |
| @sentry/nextjs | 8.40.0 |
| langfuse / langfuse-langchain | 3.30.1 |
| pino | 9.5.0 |
| resend | 4.0.1 |
| react-email | 3.0.2 |
| @react-email/components | 0.0.28 |
| puppeteer-core | 23.8.0 |
| @sparticuz/chromium | 131.0.0 |
| @observablehq/plot | 0.6.16 |
| d3 | 7.9.0 |
| mapbox-gl | 3.8.0 |
| tailwindcss | 3.4.14 |
| lucide-react | 0.460.0 |
| @radix-ui/react-dialog | 1.1.2 |
| @radix-ui/react-dropdown-menu | 2.1.2 |
| @radix-ui/react-select | 2.1.2 |
| @radix-ui/react-toast | 1.2.2 |

> **CRITICAL:** `puppeteer-core` and `@sparticuz/chromium` must move in
> lock-step — mismatched Chrome DevTools Protocol versions silently break
> headless rendering. Pin them together and bump them as a pair.

### 2.3 Dev dependencies
`vitest 2.1.5`, `@vitest/coverage-v8 2.1.5`, `msw 2.6.6`, `drizzle-kit 0.28.1`,
`biome 1.9.4`, `tsx 4.19.2`.

### 2.4 Hosted services

| Service | Purpose | Plan | Region |
|---|---|---|---|
| Vercel | Next.js host + Inngest webhook | Pro ($20/mo) | syd1 |
| Supabase | Postgres + PostGIS + Auth + Storage | Pro ($25/mo) | ap-southeast-2 |
| Inngest | Durable workflow + cron | Hobby (free up to 50k steps/mo) | Multi-region |
| Langfuse Cloud | LLM tracing | Hobby (free up to 50k obs/mo) | EU |
| Sentry | Error + perf monitoring | Developer ($26/mo) | US/EU |
| Resend | Transactional email | Free (3k/mo) | Multi-region |
| Mapbox | Map tiles + geocoding fallback | Free (up to 50k loads) | Multi-region |
| Cloudflare R2 | PDF storage | Free (up to 10 GB) | Multi-region |
| Domain Developer API | Listings, AVM, suburb stats | Standard tier (TBD) | AU |
| OpenAI | GPT-5 family (reasoning, vision, mini) | Standard | US |
| Anthropic | Claude Sonnet 4.5 fallback | Standard | US |
| Google Maps Platform | Static Street View | PAYG ($200 monthly credit) | Multi-region |

---

## 3. Repository layout

Single monorepo. Single Next.js app. **No pnpm workspaces** — overkill at this
scale.

```
buyers-agent-tool/
  src/
    app/
      page.tsx                      # dashboard
      login/page.tsx
      reports/new/page.tsx
      reports/[id]/page.tsx
      reports/[id]/pdf/route.ts
      api/
        reports/route.ts            # POST: trigger generation
        reports/[id]/route.ts       # GET: status / state
        inngest/route.ts            # Inngest webhook
        domain-stats/route.ts       # Domain stats callback proxy
    agents/
      graph.ts
      state.ts
      checkpointer.ts
      reportContext.ts              # AsyncLocalStorage holder  [R16]
      nodes/01_resolveAddress.ts
      nodes/02_fetchSubject.ts
      nodes/03_fetchCandidateComps.ts
      nodes/04a_visionAnalyseSubject.ts
      nodes/04b_visionAnalyseComps.ts
      nodes/04c_streetView.ts
      nodes/05_planningAndNews.ts
      nodes/06_reasonAndSelect.ts
      nodes/07_triangulate.ts
      nodes/08_fetchRentals.ts
      nodes/09_fetchRisks.ts
      nodes/10_compose.ts
      nodes/11_critic.ts
      nodes/12_revise.ts
      nodes/13_render.ts
    tools/
      domain/                       # 9 endpoint wrappers + client
      nsw-vg/
      planning/                     # nsw-planning, council-da, overlays
      llm/                          # provider strategy, structured call
    inngest/
      client.ts
      functions/generateReport.ts
      functions/nswVgIngest.ts      # weekly cron
    db/
      schema.ts                     # Drizzle
      migrations/
      client.ts                     # postgres + drizzle (txn-mode pool)
      client-worker.ts              # session-mode pool for Inngest worker [R17]
    lib/
      auth/                         # Supabase server + allow-list
      observability/                # sentry, langfuse, pino
    report/
      template/
      charts/
      render.ts                     # Puppeteer driver
      map.tsx
    components/                     # shadcn + custom
    schemas/                        # Zod
    prompts/                        # node prompts as TS modules
  tests/
    unit/
    integration/
  package.json
  middleware.ts
  next.config.ts
```

`[R16 / R17]` `reportContext.ts` uses AsyncLocalStorage so `domainCall` can
track per-report quota without threading `reportId` through every call site.
`client-worker.ts` exists because the Inngest worker needs session-mode pooling
for Drizzle prepared statements — see §16.3.

---

## 4. Database schema (Drizzle + Postgres + PostGIS)

### 4.1 Extensions
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### 4.2 Tables (all defined in `src/db/schema.ts`)

- **`users`** — mirrors Supabase `auth.users`, joined via email.
- **`allowed_emails`** — single source of truth for who can log in. Mutating
  this triggers a session-bust for any user removed (see §10.3).
- **`reports`** — one row per generation request.
  Columns: `id, userId, status enum {queued, running, succeeded, failed, superseded},
  version int default 1, supersedesId uuid? self-ref, state jsonb,
  subjectAddress text? — denormalised, populated at fetchSubject success;
  one of two values lifted out of `state` for cross-row UI search. See `[R25]`.
  domainPropertyId text? — denormalised, populated at fetchSubject success;
  used by the New Report dedupe lookup (`[R51]`).
  pdfUrl text?, totalCostUsd numeric(10,4), totalTokens int, currentNode text?,
  errorMessage text?, emailErrorMessage text?, emailStatus enum {pending, sent, failed},
  createdAt, updatedAt, completedAt?`

  **Indexes for dedupe:** partial index
  `(domainPropertyId, createdAt DESC) WHERE status IN ('succeeded','running')`
  — used by the firm-wide 24h dedupe query (`[R51]`).
- **`audit_log`** — append-only ledger of report generations. `details jsonb`
  but **never queried across rows** (see §4.3).
- **`nsw_vg_sales`** — composite PK `(propId, contractDate)`, PostGIS `Point`
  geometry (SRID 4326) with GIST index, btree indexes on `suburb / postcode`
  and `contract_date`.
- **`llm_calls`** — per-node `provider / model / tokens / costUsd numeric(10,6)
  / latencyMs / succeeded / langfuseTraceId`. Used for the per-node cost table
  in §11.
- **`rate_limit_counters`** — PK `(userId, day)`. `count` is incremented **only
  on successful generation** (see §11.1).
- **`report_versions`** — `(reportId, version, pdfUrl, stateSnapshotKey,
  createdAt)`. New row per regeneration (see §7.16). `[R7]`
- **`report_node_artifacts`** — per-item durable output for resumable
  multi-item nodes (04b vision-comps, 09 risks-by-category, 10 compose-by-
  section, 12 revise iterations). PK `(reportId, node, itemKey)`.
  Columns: `payload jsonb, costUsd numeric(10,6), revisionRound int default
  0, createdAt`. Nodes write a row per successful item **before** mutating
  in-memory state, and hydrate already-completed items from this table at
  node entry. This is what makes mid-node crash resumption actually safe —
  LangGraph's `PostgresSaver` only checkpoints at super-step boundaries, so
  partial progress inside a single node would otherwise be lost. See
  §6.3 and `[R21]`.

### 4.3 Domain TOS compliance — data-model guardrails

Domain's TOS prohibits storing listing data in a way that creates a queryable
cache. Our compliance model:

1. `reports.state` is a **point-in-time snapshot tied to a single report**. It
   is only ever fetched by primary key (`reports.id`).
2. **Defense-in-depth, not a single control.** The application connects
   as a dedicated `api_reader` Postgres role with no DDL, no `SELECT` on
   admin or ingest tables, and no write access to `nsw_vg_sales`.
   Postgres permissions alone **cannot** enforce "by-id-only queries
   against `reports`" — once `SELECT` is granted, any `WHERE` clause is
   legal. The *real* enforcement is point 3 below; the role limits the
   blast radius if 3 is bypassed. `[R26]`
3. **Custom ESLint rule + code review** is the primary control.
   Cross-report analytical queries are explicitly forbidden. Drizzle
   queries against `reports` **must** include `.where(eq(reports.id, …))`
   *unless* they only touch denormalised top-level columns (`status`,
   `createdAt`, `userId`, `subjectAddress`). The ESLint rule flags any
   `db.select(...).from(reports)` whose chain references `reports.state`
   without an `id` predicate, with no allow-list exceptions.
4. **State retention:** `reports.state` is purged 90 days after status becomes
   `succeeded` or `superseded`. A nightly Inngest cron does the purge.
   `pdfUrl` + `reports` row remain (no listing data).
5. `audit_log.details` stores **only IDs** (report id, user id, node names,
   status, costs). No listing fields. Audited via a Zod schema applied at
   the write site.
6. Suburb-stats responses are kept only in-process (per request).
   NSW VG bulk PSI is government open data and is fine to persist long-term.
7. **OpenAI vision transmission:** Domain photo URLs are passed to OpenAI
   vision for nodes 04a/04b/04c. This is a transmission to a third party.
   **Before launch, confirm in writing with Domain** that vision-augmented
   analysis of Domain-hosted media is permitted under the API tier we hold.
   If not, fall back to text-only comp analysis.

`[R3]` Original §4.3 stated the snapshot interpretation as fact. We now have
an explicit guardrail (role + lint rule), a retention rule, and a flagged
TODO for Domain sign-off on vision transmission.

---

## 5. State shape — single source of truth

`src/schemas/state.ts` defines every type that flows through the graph. All
external data is validated into these types before the graph touches it.

### 5.1 Sources & provenance
```ts
// SourceRef is attached to every numeric or factual claim
const SourceRefSchema = z.object({
  provider: z.enum([
    'domain','nsw-vg','mapbox','street-view',
    'nsw-planning','council-da','overlays','derived','llm'
  ]),
  endpoint: z.string(),
  fetchedAt: z.string().datetime(),
  // JSON Pointer (RFC 6901) into ReportState locating the canonical value
  // of this claim — e.g. "/subject/domainAvm/mid" or
  // "/comparables/3/salePrice". REQUIRED because `raw` is stripped before
  // persistence; without `path` the deterministic critic (§7.13 Pass 1)
  // has nothing to look up. Compose populates it; a path that does not
  // resolve at critic time is itself a blocker finding. [R22]
  path: z.string().regex(/^(\/[^/]+)+$/),
  raw: z.unknown().optional(),  // dev-mode only; stripped before persistence
});
type Sourced<T> = { value: T; source: SourceRef };
```

### 5.2 Key types (abbreviated)
- **`ResolvedAddress`** — `domainPropertyId, gnafId?, lat, lng, suburb, postcode,
  state enum ['NSW','VIC','WA']`
- **`SubjectProperty`** — `attrs (beds/baths/parking/landArea/buildingArea),
  photos[], listing?, visionAnalysis?, streetView?,
  domainAvm: { low, mid, high, confidence, source }`
- **`Comparable`** — `id, address, salePrice, contractDate, distanceM, beds, baths,
  landArea, photos[], visionAnalysis?, similarityScore (0–100),
  selection enum {'fair-value','negotiation-anchor','rejected','candidate'},
  adjustments[] (dimension, deltaPct, rationale, sourceRef[]),
  adjustedValue, adjustmentNarrative, source: SourceRef`
- **`MarketContext`** — `suburbStats, recentNews[], recentDAs[]`
- **`RiskFlag`** — `category enum {flood, bushfire, heritage, contamination, noise,
  flightpath, planning, strata, market}, severity enum {critical, high, medium,
  low, informational}, description, sourceRef, evidence`
- **`TriangulatedValue`** — `domainAvm, compDerived, rentalImplied, reconciled,
  weights (sum=1.0), narrative`
- **`RentalEvidence`** — `domainRentalAvm, activeRentals[], indicativeWeeklyRent,
  grossYieldPct`
- **`NegotiationPack`** — `daysOnMarketSignal, suggestedOpeningOffer { value,
  anchorCompIds[] }, walkAwayPrice, positioning enum {move-fast, negotiate-hard,
  wait, pass}`. **NOTE:** per-agency historical underquote signal is **removed
  from v1** (`[R13]` — no clean per-agency historical guide-vs-sold data in
  the Domain API; our own NSW VG sample wouldn't reach significance for ~6
  months).
- **`ReportProse`** — `{ sectionId: 'summary'|'subject'|'valuation'|'comparables'
  |'rentals'|'market'|'risks'|'planning'|'negotiation', blocks: ClaimBlock[] }`
  (see §7.12). **Replaces the original free-prose model** so the critic can
  diff JSON instead of regex-matching text. `[R4]`
- **`CriticFinding`** — `severity enum {blocker, major, minor}, section, claim?,
  description`
- **`ReportState`** — umbrella type

`[R14]` Triangulate weights validated to sum to 1.0 (±0.01) via `z.refine`
— see §7.9.

---

## 6. The LangGraph graph

### 6.1 State annotation & reducers
`LangGraph Annotation.Root`, with explicit reducers per field:

- `comparables` — **merge-by-key** reducer, keyed on `comp.id`. Incoming
  partial entries are deep-merged into existing ones (per-field
  last-write-wins); entries not present in the incoming array are preserved.
  This is what makes the per-item idempotency in Node 04b safe. `[R20]`
- `risks` — **merge-by-key**, keyed on `risk.category`.
- `prose` — **merge-by-key**, keyed on `sectionId`. Lets compose-by-section
  and revise both write partial updates without losing other sections.
- `criticFindings` — **replacement** (each critic pass *replaces* the
  current findings set; we don't carry an additive history).
- `errors` — append.
- `llmCalls` — append.

> The old "replacement" reducer for `comparables` / `risks` / `prose` was
> incompatible with the per-item idempotency contract: a node emitting
> only the items it *just* processed would wipe items processed in a
> prior, crashed run. Merge-by-key fixes that without forcing every node
> to re-emit the full array. `[R20]` supersedes the earlier `[Edit]` note.

### 6.2 Graph wiring
```ts
const MAX_REVISIONS = 2;

graph
  .addNode('resolveAddress',     resolveAddress)
  .addNode('fetchSubject',       fetchSubject)
  .addNode('fetchCandidateComps',fetchCandidateComps)
  .addNode('visionSubject',      visionAnalyseSubject)
  .addNode('streetView',         streetViewAnalyse)
  .addNode('planningAndNews',    planningAndNews)
  .addNode('fetchRentals',       fetchRentals)
  .addNode('fetchRisks',         fetchRisks)
  .addNode('visionComps',        visionAnalyseComps)
  .addNode('reasonAndSelect',    reasonAndSelect)
  .addNode('triangulate',        triangulate)
  .addNode('compose',            compose)
  .addNode('critic',             critic)
  .addNode('revise',             revise)
  .addNode('render',             render)
  .addEdge(START, 'resolveAddress')
  .addEdge('resolveAddress', 'fetchSubject')
  // fan-out from fetchSubject
  .addEdge('fetchSubject', 'fetchCandidateComps')
  .addEdge('fetchSubject', 'visionSubject')
  .addEdge('fetchSubject', 'streetView')
  .addEdge('fetchSubject', 'planningAndNews')
  .addEdge('fetchSubject', 'fetchRentals')
  .addEdge('fetchSubject', 'fetchRisks')
  // visionComps runs after candidate comps
  .addEdge('fetchCandidateComps', 'visionComps')
  // join into reasonAndSelect
  .addEdge(['visionSubject','streetView','planningAndNews','visionComps'], 'reasonAndSelect')
  .addEdge(['reasonAndSelect','fetchRentals'], 'triangulate')
  .addEdge(['triangulate','fetchRisks'], 'compose')
  .addEdge('compose', 'critic')
  .addConditionalEdges('critic', shouldRevise, { revise: 'revise', render: 'render' })
  .addEdge('revise', 'critic')
  .addEdge('render', END);

function shouldRevise(s: ReportState) {
  if ((s.reviseIterations ?? 0) >= MAX_REVISIONS) return 'render';
  const blockers = s.criticFindings.filter(f => f.severity === 'blocker').length;
  const majors   = s.criticFindings.filter(f => f.severity === 'major').length;
  return (blockers > 0 || majors >= 2) ? 'revise' : 'render';
}
```

### 6.3 Checkpointer
```ts
const checkpointer = PostgresSaver.fromConnString(WORKER_DATABASE_URL);
await checkpointer.setup();  // idempotent
```
`WORKER_DATABASE_URL` points to the **session-mode** pool (see §16.3);
checkpoint writes use prepared statements that don't survive PgBouncer
transaction mode.

**Mid-node durability.** `PostgresSaver` only checkpoints at super-step
boundaries — i.e. between LangGraph nodes, not inside them. So a node that
internally processes 30 comps and crashes at comp 17 would, by default,
lose all 17 results. Multi-item, money-spending nodes (04b, 09, 10, 12)
work around this by writing each completed item to `report_node_artifacts`
(§4.2) in its own short transaction, **before** mutating in-memory state.
At node entry, the node hydrates already-completed items from that table
and skips them. The merge-by-key reducers (§6.1) and the side table are
two halves of the same mechanism: the table makes work durable; the
reducers stop a subsequent node-output from clobbering it. `[R21]`

### 6.4 Graph resumption contract `[R1]`

Each graph invocation is wrapped in an Inngest workflow split into named
steps. Each step corresponds to a 'safe-to-resume' boundary in the graph.
On Vercel function timeout or worker crash, Inngest retries the step and
the graph resumes from the last completed boundary because `PostgresSaver`
has checkpointed it.

Each step budget includes a **1.5× safety factor on observed P50**. Sum ≈
320 s — but **no single step exceeds Vercel Pro's 300 s function limit**, so
a step retry is always recoverable.

**Per-item idempotency in fan-out nodes:**
- `visionAnalyseComps` writes per-comp results into
  `state.comparables[i].visionAnalysis`. On retry, comps with a non-null
  `visionAnalysis` are skipped — no double charge for the 17 comps that had
  already completed before the timeout.
- `fetchRisks` writes per-category results into `state.risks`. On retry,
  present categories are skipped.
- `compose` writes per-section blocks into `state.prose`. On retry, present
  sections are skipped.

| Inngest step | Graph slice it covers | Budget | Resumes from |
|---|---|---|---|
| **S1 prepare** | `resolveAddress` + `fetchSubject` | < 25 s | `START` |
| **S2 fetch-fanout** | `fetchCandidateComps, visionSubject, streetView, planningAndNews, fetchRentals, fetchRisks` (parallel) | < 70 s | `fetchSubject` checkpoint |
| **S3 vision-comps** | `visionComps` (30 × p-limit 6) | < 45 s | `fetchCandidateComps` checkpoint |
| **S4 reason** | `reasonAndSelect + triangulate` | < 60 s | join checkpoint |
| **S5 compose** | `compose` (9 parallel) + `critic` + up to 2 revise loops | < 90 s | `triangulate` checkpoint |
| **S6 render** | `render` (Puppeteer + R2 upload + DB update + email) | < 75 s | `compose` checkpoint |

> S6 must exceed the Puppeteer `page.setContent` timeout (§13.3, 60 s) by
> enough headroom for R2 upload + the two DB writes. 75 s gives ~15 s of
> margin and stays well below Vercel Pro's 300 s function limit.

---

## 7. Node specifications

### 7.1 Node 01 — `resolveAddress`
Validate, normalise and geocode. **Domain Address Suggestions** primary;
**Mapbox geocoding** fallback. **No LLM.**
- Throws `AddressResolutionError` if no suggestion meets confidence threshold.
- Throws `UnsupportedRegionError` if `state ∉ {NSW, VIC, WA}` or if the
  Phase 1 LGA gate is enabled and the LGA is not in the supported set.

### 7.2 Node 02 — `fetchSubject`
Pulls from Domain:
- `GET /v1/properties/{propertyId}` — attrs
- `GET /v1/properties/{propertyId}/priceEstimate` — AVM
- `POST /v1/listings/residential/_search` — current listing (if any)

**No LLM.** Validates with Zod. Writes `SubjectProperty` into state.

### 7.3 Node 03 — `fetchCandidateComps`

> **NSW VG vs Domain tiebreaker (`[R40]`).** When a sale appears in
> *both* sources for the same property:
> - **Use the NSW VG row's `salePrice` and `contractDate`** — government
>   records of settlement, authoritative.
> - **Use the Domain row's `address`, `propertyType`, `beds/baths/parking`,
>   `photos[]` and `listing` metadata** — Domain has structured
>   attribute data NSW VG lacks.
> - Mark the comp's `source.provider = 'domain+nsw-vg'` and keep both
>   `SourceRef`s on the merged record. The compose narrative can
>   surface this provenance if useful.
> Dedupe key is `(suburb, normalisedStreetAddress, contractDate)` with
> a ±1-day tolerance on `contractDate` to absorb settlement-vs-listing
> drift.

Generate a **30-candidate pool** from two tiers and score by similarity.

- **Tier 1** — Domain Listings, sold within 180 days, same suburb, matching
  `propertyType`, `beds ± 1`, `baths ± 1`, top 50 by recency.
- **Tier 2** — local NSW VG via PostGIS `ST_DWithin(geom, subject.geom, 1500m)`,
  `contract_date > now() - 180d`, same `zone_code`, top 30 by distance.
- Dedupe by address (keep Domain version).
- Score with the similarity function below; keep top 30.

```ts
// similarity scoring (start 100, deduct)
let s = 100;
s -= Math.max(0, Math.min(30, weeksSinceSale - 4));            // recency
s -= Math.max(0, Math.min(25, (distanceM - 200) / 100));        // distance
s -= Math.abs(c.beds - subj.beds) * 10;                         // beds
s -= Math.abs(c.baths - subj.baths) * 8;                        // baths
if (c.propertyType !== subj.propertyType) s -= 20;
if (subj.propertyType === 'House') {                            // land area (houses only)
  const pct = Math.abs(c.landArea - subj.landArea) / subj.landArea;
  s -= Math.min(15, Math.floor(pct * 10));
}
return Math.max(0, s);
```

### 7.4 Node 04a — `visionAnalyseSubject`
**GPT-5 vision** over current listing photos. Skip if listing is null. Outputs
Zod-validated `condition` enum, `presentationFactors[]`, `staging`, `redFlags[]`.
Cost ≈ **$0.05** per call for a 20-photo subject — acceptable at our volume.

**Frozen enums (`[R42]`).** Schema-locked at the Zod boundary so
downstream prose stays consistent across runs and any drift surfaces as
a Zod parse failure rather than a vibes change in language:
- `condition`: `'excellent' | 'good' | 'fair' | 'poor' | 'unliveable'`
- `staging`: `'professionally-staged' | 'lived-in-tidy' | 'lived-in-cluttered' | 'vacant' | 'partly-furnished'`
- `presentationFactors[]` and `redFlags[]`: open `string` arrays, but
  capped at 6 items each and each item ≤ 80 chars (prevents prose
  bloat in the report).

Equivalent freezes for **Node 04b** (per-comp `condition` uses the same
enum) and **Node 04c**:
- `treeCover`: `'high' | 'medium' | 'low'`
- `busyRoad`: `boolean`
- `streetCharacter`: `'leafy-residential' | 'arterial' | 'commercial-frontage' | 'industrial-adjacent' | 'mixed' | 'unclassified'`
- `neighbouringConcerns[]`: ≤ 4 items, ≤ 80 chars each.

### 7.5 Node 04b — `visionAnalyseComps`
Fan-out using `p-limit(6)`. Each call ~5 s with 8 photos. Total ~25–30 s for
30 comps. Cost ≈ **$0.02 per comp ≈ $0.60 for 30**. Graceful: on per-comp
failure continue without vision for that comp; do not abort the node.

**Idempotency:** before mutating `state.comparables[i].visionAnalysis`,
the node writes the per-comp result to `report_node_artifacts`
(`node='visionComps'`, `itemKey=compId`) in its own short transaction.
At node entry, it hydrates `state.comparables[i].visionAnalysis` from
that table; comps already present are skipped. This survives mid-node
crashes — see §6.3 and `[R21]`.

### 7.6 Node 04c — `streetView`
Google Maps Static Street View at **4 headings** (0, 90, 180, 270). GPT-5
vision extracts `streetCharacter, busyRoad (bool), treeCover enum {high,
medium, low}, neighbouringConcerns[]`.

### 7.7 Node 05 — `planningAndNews`
Recent DAs near subject (within 500 m, last 12 months).
- **Primary:** NSW Planning Portal API (covers all NSW LGAs at metadata level).
- **Supplementary council JSON feeds (deeper detail):** Sydney City, Inner
  West, Randwick, Waverley.
- If subject LGA has a supplementary feed → hydrate DAs with `description /
  status / category`.
- If subject LGA has no supplementary feed → use Portal metadata only and mark
  `recentDAs[i].coverage = 'metadata-only'`. The composed prose will indicate
  reduced confidence.
- **GPT-5-mini** for DA relevance classification (cheap; ~$0.003 per call).

`[R10]` Coverage gap addressed: instead of silently dropping DAs in
unsupported councils, the spec now defines a degraded mode (metadata-only)
and the prose reflects it.

### 7.8 Node 06 — `reasonAndSelect` (keystone)
The deepest LLM call in the pipeline. **GPT-5 with `reasoning_effort: 'high'`**.
Takes 30 enriched candidates, returns array with `selection / adjustments /
narrative / adjustedValue`.

**Prompt rules:**
- Never invent attributes.
- Adjustments per dimension as % deltas (positive = subject worth **more**).
- Total adjustments per comp should rarely exceed ±15 % — if they do, reject
  the comp.
- Reject sales > 180 days unless justified.
- Select **4–5 'fair-value'** and **2–3 'negotiation-anchor'**.

**Cost:** $0.30 – $0.80 per call typical, up to ~$1.20 on a 30-comp pool with
high reasoning. Largest single line item. Acceptable inside the $10 ceiling
(§11).

### 7.9 Node 07 — `triangulate`
Reconcile **Domain AVM**, **comp-derived** (weighted by `similarityScore`),
and **rental-yield-implied** (rent × 52 / typical suburb yield). GPT-5
standard reasoning picks weights and produces narrative.

**Confidence propagation (`[R43]`).** Domain's AVM response carries a
`confidence` ordinal (`high | medium | low`). We translate it to a numeric
prior weight (`high=1.0, medium=0.7, low=0.4`) and pass it as a hint to
the LLM in the triangulate prompt. The LLM's final weights are still its
choice (must sum to 1.0), but a `low`-confidence Domain AVM that
nonetheless gets a 0.8 weight is itself a finding the critic should
flag — see the divergence guardrail below.

**Divergence guardrail (`[R44]`).** Compute
`spread = (max(values) - min(values)) / median(values)`. If `spread >
0.25` (a quarter of the median), the triangulate prompt is required to
emit an extra `uncertaintyNote: string` block in the narrative *and*
the reconciled value's `confidence` lands at `'low'`. The compose
"valuation" prompt is given the `confidence` and is required to surface
"value-range uncertainty" prose in that case rather than presenting a
single point estimate.

Weights validated:
```ts
const TriangulatedValueSchema = z.object({
  domainAvm:     z.number(),
  domainAvmConfidence: z.enum(['high','medium','low']),
  compDerived:   z.number(),
  rentalImplied: z.number().nullable(),  // null when rentals unavailable
  reconciled:    z.number(),
  confidence:    z.enum(['high','medium','low']),
  spread:        z.number().min(0),       // derived, validated
  weights: z.record(z.string(), z.number())
    .refine(w => Math.abs(Object.values(w).reduce((a,b)=>a+b,0) - 1) < 0.01,
            'triangulation weights must sum to 1.0'),
  uncertaintyNote: z.string().nullable(), // required when spread > 0.25
  narrative: z.string().min(60),
}).refine(
  v => v.spread <= 0.25 || (v.confidence === 'low' && v.uncertaintyNote !== null),
  'high spread requires confidence=low and an uncertaintyNote',
);
```

### 7.10 Node 08 — `fetchRentals`
Domain Rental AVM + Listings rent search within 1 km. Computes
`indicativeWeeklyRent + grossYieldPct`.

### 7.11 Node 09 — `fetchRisks`
Phase-1 NSW sources, all in parallel and per-category idempotent:
- **Flood** — NSW Spatial Services flood WFS (chosen over the SES API: WFS
  exposes the underlying flood-planning layers our risk model needs). `[R12]`
- **Bushfire** — NSW Rural Fire Service Bushfire Prone Land WFS.
- **Heritage** — NSW Heritage Register API.
- **Noise** — distance-based heuristics from rail, airports, motorways using
  Geoscape data (ingested once via nsw-vg-style pipeline; refreshed annually).

**Idempotency:** each category writes a row to `report_node_artifacts`
(`node='risks'`, `itemKey=category`) before being merged into `state.risks`
via the merge-by-key reducer. On retry, categories already present are
skipped. `[R21]`

### 7.12 Node 10 — `compose` (structured claims, not free prose) `[R4]`
**GPT-5 standard reasoning** (not high). **One LLM call per prose section, in
parallel (9 calls).** Each sees only its slice of the state. Voice rules:
direct, confident, specific; no marketing language; plain Australian English;
prices in AUD.

**Output format change:** instead of free prose, each section returns an
array of typed `ClaimBlock`s. Prose is rendered from blocks at PDF time.
This makes the critic deterministic (it diffs claim values against state,
not regex over text).

```ts
const ClaimBlock = z.discriminatedUnion('type', [
  // narrative text — no numbers; the critic checks via embedding similarity, not values
  z.object({ type: z.literal('text'), text: z.string() }),
  // single numeric claim
  z.object({
    type: z.literal('claim'),
    text: z.string(),                       // e.g. "Median price rose {{v}} YoY"
    value: z.union([z.number(), z.string()]),
    format: z.enum(['currency-aud','percent','count','date','distance-m','duration-days']),
    sourceRef: SourceRefSchema,
  }),
  // multi-value claim (e.g. range)
  z.object({
    type: z.literal('range'),
    text: z.string(),                       // "Estimated value {{lo}}–{{hi}}"
    low: z.number(), high: z.number(),
    format: z.enum(['currency-aud','percent']),
    sourceRef: SourceRefSchema,
  }),
  // explicit reference to a comparable
  z.object({
    type: z.literal('comp-ref'),
    text: z.string(),
    compId: z.string(),
  }),
]);
type ReportProse = Record<SectionId, ClaimBlock[]>;
```

**Render:** at PDF time, `{{v}}`, `{{lo}}`, `{{hi}}` are substituted from the
typed values using the format hint. Currency uses AUD locale + `tabular-nums`;
percent rounded to 1 d.p.; etc.

**Idempotency:** each completed section is written to
`report_node_artifacts` (`node='compose'`, `itemKey=sectionId`,
`revisionRound=0`) before being merged into `state.prose`. At node entry,
completed sections are hydrated from the table and skipped. Revise (§7.14)
also uses this table with `revisionRound > 0`. `[R21]`

### 7.13 Node 11 — `critic`
**Two passes.**

**Pass 1 (deterministic, structured):** for each `ClaimBlock` of type
`claim` or `range`, resolve `sourceRef.path` (`[R22]`) against `state` as
a JSON Pointer (RFC 6901) to obtain the canonical value. Compare with
rounding tolerance:
- `currency-aud` — equal within **±$5,000 or ±0.5 %**
- `percent` — equal within **±0.5 pp**
- `count, duration-days, distance-m` — equal within **±5 %**
- `date` — same calendar week

Mismatch → **blocker** finding. A `sourceRef.path` that does not resolve
in `state` is *also* a **blocker** — the compose model invented or
mis-pointed a source, and we don't render a PDF on that.

**Pass 2 (LLM):** GPT-5 standard reasoning. Give full prose + state slices.
Severity classes spelled out in prompt:
- **blocker** — unsupported claim, contradicting recommendation, or factually
  wrong statement about a comparable.
- **major** — vague language, unexplained large comp difference, unmentioned
  high-severity risk.
- **minor** — tone, repetition, awkward phrasing.

### 7.14 Node 12 — `revise`
For each finding, regenerate **the affected section only** (compose is
per-section, so this is targeted). `state.reviseIterations++`. If ≥ 2 after
this run, the next critic edge forces `render`. **Defensive: must terminate.**

**Iteration counter durability.** `state.reviseIterations` is incremented
to `n+1` and recorded as a row in `report_node_artifacts`
(`node='revise'`, `itemKey='iter-{n+1}'`) in the **same transaction**,
*before* any section regeneration runs. That way a crashed revise
iteration still counts against `MAX_REVISIONS` after Inngest retries
the step — eliminating any path to an infinite revise loop across
retries. Each regenerated section is written with `revisionRound = n+1`,
so it never collides with the original compose row (`revisionRound = 0`).
`[R29]`

### 7.15 Node 13 — `render`
SSR React → HTML → Puppeteer (`@sparticuz/chromium`) → A4 PDF with
`displayHeaderFooter: true` → upload to R2 with key
`reports/{reportId}/v{version}.pdf` → write `report_versions` row →
`UPDATE reports` row to `status='succeeded'`.

**Downloads stream through our server**, they don't 302 to a signed R2
URL. `/reports/[id]/pdf` authenticates the request, fetches the object
from R2 server-side (using a short-lived signed URL it never returns to
the client), and streams the bytes back with
`Content-Type: application/pdf` + `Content-Disposition: attachment`.
This means: (a) the signed URL never leaves the backend — no browser
history / referrer leakage; (b) we get per-download audit entries; (c)
no public R2 URL ever exists. Bandwidth cost is negligible at our
volume (≤ 20 reports/user/day × ~6 MB). `[R47]`

### 7.16 Versioning rules `[R7]`
- A regen **always creates a new `reports` row** (new id) with
  `version = parent.version + 1` and `supersedesId = parent.id`. Parent
  row's status is set to `'superseded'` atomically.
- Superseded reports remain readable and their PDFs remain downloadable
  (the dashboard offers a 'history' affordance).
- Auto-purge of `reports.state` still applies (90 days after status moves to
  `succeeded` or `superseded`).
- **Triggers for regen:** explicit user click, or critic blockers exceeded
  `MAX_REVISIONS` in a prior run.

### 7.17 Partial-data / graceful-degradation policy `[R8]`

| Data source | Required for completion | Failure policy | PDF effect |
|---|---|---|---|
| Domain — property + AVM | **Yes** | Abort (`RetryableError → DomainQuotaError → fail`) | — |
| Domain — comps (Tier 1) | No (fall back to Tier 2 NSW VG) | Degrade: log warning, proceed with Tier-2-only pool | 'Comparables sourced from NSW VG sales only' note |
| NSW VG (Tier 2) | No | Degrade: Tier 1 only | No note |
| GPT-5 vision (subject / comps) | No | Skip vision; reasoning still runs on attributes | Adjustments narrative explains lack of vision evidence |
| Street View | No | Skip; `streetView` field null | 'Street View imagery unavailable for this address' |
| NSW Planning + council DA | No | Skip `recentDAs` | 'No planning activity could be retrieved for this address' |
| Flood WFS | No | Per-category null in `risks` | Risk register shows 'data unavailable' for that category |
| Bushfire WFS | No | Per-category null | Same as above |
| Heritage API | No | Per-category null | Same as above |
| Rentals | No | Skip triangulation weight for `rentalImplied` (re-normalise weights) | Rental section omitted; narrative note |

Adds a new `PartialDataError` to the error hierarchy used by degraded paths
so we can count them in Sentry.

---

## 8. Tool layer specifications

### 8.1 Domain client
`domainCall<T>(endpoint, params, schema, opts)` is the single point of access.
Wraps `fetch` with `pRetry` (`retries: 4, minTimeout: 1000, maxTimeout: 10000,
factor: 2`, retries on 429 + 5xx). Bearer-token auth. Zod-validates response.
Optional `cacheKey` for **in-process memo only** — never for cross-request cache.

**Per-report quota counting** uses AsyncLocalStorage:
```ts
// src/agents/reportContext.ts
import { AsyncLocalStorage } from 'node:async_hooks';
type Ctx = { reportId: string; domainCalls: number; costUsd: number };
export const reportCtx = new AsyncLocalStorage<Ctx>();

// in domainCall:
const ctx = reportCtx.getStore();
if (ctx) {
  ctx.domainCalls += 1;
  if (ctx.domainCalls > DOMAIN_CALLS_PER_REPORT) throw new DomainQuotaError();
}
```
`[R16]` Replaces the original spec's implicit "`domainCall` has the report
id somehow". AsyncLocalStorage is the right primitive in Node.

### 8.2 Domain endpoints (9 wrappers)

| Wrapper | HTTP path | Used by |
|---|---|---|
| `addressSuggestions` | `GET /v1/addressLocators` | Node 01 |
| `getProperty` | `GET /v1/properties/{id}` | Node 02 |
| `getPriceEstimate` | `GET /v1/properties/{id}/priceEstimate` | Node 02, 07 |
| `getRentalEstimate` | `GET /v1/properties/{id}/rentalEstimate` | Node 08 |
| `searchListingsSold` | `POST /v1/listings/residential/_search` (sold) | Node 02, 03 |
| `searchListingsRent` | `POST /v1/listings/residential/_search` (rent) | Node 08 |
| `suburbStats` | `GET /v1/suburbPerformanceStatistics/...` | Node 10 |
| `auctionResults` | `GET /v1/salesResults/...` | Node 10 |
| `schools` | `GET /v1/schools/...` | Node 02 |

### 8.3 Domain TOS compliance hooks
Anchored to the Domain developer FAQ (May 2026) requirements: powered-by
logo, stats callbacks, UTM-tagged links to the canonical listing,
no-paywall on agent-contact and price-estimate display, and the
"don't cache" guidance handled separately via §4.3.

- **Stats callback (required, with retry).** Every listing rendered in
  any user-visible surface — dashboard card, report preview, **and PDF
  asset fetch** — emits a stats event. Implemented as a server-side
  fan-in at `/api/domain-stats` that batches events and forwards to
  Domain's stats endpoint with `DOMAIN_API_KEY`. On forward failure,
  events land in a `pending_stats_callbacks(listingId, payload,
  attempts, nextAttemptAt)` queue and are retried by an Inngest cron
  every 5 minutes with exponential backoff (cap 24 h, max 12
  attempts). Without retry, transient outages would silently lose
  attribution — a TOS exposure. `[R37]`
- **Server-side fire at PDF render time** for every comp/listing in
  the report, even if the user never opens the preview. The PDF is the
  artifact that lives longest and is most likely to be circulated
  internally; firing stats at render guarantees Domain sees a view per
  listing per generated report. `[R38]`
- **'Powered by Domain'** logo hard-coded in PDF footer and in the
  preview UI as an inlined SVG.
- **Per-listing attribution in PDF body.** Each comp card in the
  Comparables section renders a "Source: Domain.com.au" line directly
  beneath it, hyperlinked (in the digital PDF) to the canonical Domain
  URL with the required UTM tag. Footer-only attribution does not
  satisfy the FAQ requirement that *each* listing reference resolves
  back to the original. `[R39]`
- **UTM tag.** `utm_source=<licensee_id>&utm_medium=referral&
  utm_campaign=propsearch_report` — exact values confirmed with Domain
  at the F5 sign-off (the licensee_id parameter is the variable bit).
  All link construction goes through `lib/links/domainUrl.ts`; no
  hand-built URLs allowed.
- Domain photo URLs sent to OpenAI vision — see §4.3 for the
  launch-gate confirmation step. **Photos are passed as URLs**, not as
  re-hosted bytes, so Domain's CDN logs see the fetch and we don't
  redistribute the imagery ourselves. This is the safer side of the
  TOS gray area; lock it in.
- **Paywall concern.** The Domain FAQ states price-estimate data and
  agent-contact must not be behind a paywall. Our app *is* behind an
  email allow-list. This is a known TOS gray area — the firm is the
  licensee using Domain data for its own buyer's-agent workflow, not
  exposing it to end consumers. Resolve at F5 sign-off in writing;
  document the licensee-of-record interpretation there.

### 8.4 NSW VG ingest
- **Inngest cron** — Tuesday 06:00 AEST (`TZ=Australia/Sydney 0 6 * * 2`).
- `resolveLatestPsiUrl()` — opens the NSW Valuer General weekly PSI page,
  parses the published ZIP filename pattern. **Schema-fragile:** any change to
  the page breaks ingest. A schema-drift alert is wired into Sentry.
- Stream-download the ZIP, parse the pipe-delimited ASCII files, upsert into
  `nsw_vg_sales`.
- Reindex PostGIS GIST.
- Government open data; persistence is fine.
- **Quantitative drift tripwires** (in addition to the URL-pattern
  exception). After each run, compare with the prior week and alert
  Sentry if **any** check fails — the throw-only check from the
  original spec misses "wrong-shape but parses" failures. `[R31]`
  - **Row count delta** outside ±25% week-on-week.
  - **Distinct suburb count** < 200 (Sydney metro floor; real value
    typically > 400).
  - **Contract-date histogram:** at least one sale dated within the
    last 14 days.
  - **Column-presence sanity:** every row carries non-null
    `propId`, `contractDate`, `purchasePrice`, `district`. If null-rate
    exceeds 1% on any of these, alert.
  - **Outlier filter** (see §7.3.1 below): rows flagged as
    non-arms-length are excluded from `nsw_vg_sales` outright.

### 8.5 Street View tool
```ts
function streetviewUrl(lat: number, lng: number, heading: number) {
  const u = new URL('https://maps.googleapis.com/maps/api/streetview');
  u.searchParams.set('size', '640x640');
  u.searchParams.set('location', `${lat},${lng}`);
  u.searchParams.set('heading', String(heading));
  u.searchParams.set('pitch', '0');
  u.searchParams.set('fov', '90');
  u.searchParams.set('return_error_code', 'true');
  u.searchParams.set('key', env.GOOGLE_MAPS_KEY);
  return u.toString();
}
```
Google Maps key **must be restricted by HTTP-referrer or IP-allowlist** to
the Vercel deployment domain — see §16.2. `[R18]`

---

## 9. LLM client layer

### 9.1 Provider strategy
- **Primary:** OpenAI **GPT-5** for reasoning nodes (06, 07, 11); **GPT-5**
  for compose (10); **GPT-5-mini** for cheap classification (Node 05 DA
  relevance).
- **Vision:** GPT-5 vision for 04a/04b/04c.
- **Fallback:** Anthropic **Claude Sonnet 4.5** — triggered on a single
  OpenAI failure (5xx, rate-limit, schema-validation) inside
  `callWithFallback`. `pRetry` is already applied inside `structuredCall`
  for transient OpenAI failures; one outer try is enough before falling back.
  `[R15]`
- **Both-providers-down handling.** If the Anthropic fallback also fails
  (transport, rate-limit, or schema), `callWithFallback` throws a typed
  `LlmProvidersUnavailableError` (code `LLM_PROVIDERS_UNAVAILABLE`). The
  graph treats this as a *retryable* condition — Inngest will retry the
  step once with its standard backoff. If the retry also fails the
  report is marked `failed` with a user-facing message asking to retry
  later. We do **not** burn the user's daily quota for this class of
  failure. `[R34]`
- Model IDs pinned in env: `OPENAI_MODEL_REASONING, OPENAI_MODEL_COMPOSE,
  OPENAI_MODEL_MINI, OPENAI_MODEL_VISION, ANTHROPIC_MODEL_FALLBACK`.
  Resolved at boot; logged at startup.

### 9.3 Prompt versioning
Every prompt module under `src/prompts/` exports a `version` string (e.g.
`'v3.2'`) alongside its `messages` / template. Bumping the version is the
explicit signal that "any downstream regression test against this prompt
must be re-recorded."

- `llm_calls.prompt_version text` column records the value used for each
  call. Searchable + dashboardable in Langfuse via a tag.
- The Node 06 keystone regression test (C5) pins the expected
  `version`. If the live module's version differs, the test fails fast
  with "prompt baseline stale — re-record fixtures." No silent drift.
- The compose section prompts (one per `SectionId`) each have their own
  version; that way a tweak to the "valuation" voice doesn't invalidate
  the "rentals" baseline.

`[R30]`

### 9.2 Unified call interface
```ts
type StructuredCallOpts<T> = {
  model: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  temperature?: number;
  schema: z.ZodType<T>;
  messages: ChatCompletionMessageParam[];
};

async function structuredCall<T>(opts: StructuredCallOpts<T>): Promise<T> { /* … */ }

async function callWithFallback<T>(opts: StructuredCallOpts<T>): Promise<T> {
  try {
    return await structuredCall(opts);                            // pRetry inside
  } catch (e) {
    logger.warn({ err: e }, 'OpenAI failed, falling back to Claude');
    return await structuredCallAnthropic({ ...opts, model: env.ANTHROPIC_MODEL_FALLBACK });
  }
}
```

---

## 10. Authentication

### 10.1 Supabase config
- Google provider enabled
- Redirect URLs restricted to **production + `http://localhost:3000`**
- **JWT expiry: ≤ 4 hours.** Supabase's current default is 1 h (3600 s),
  which already beats the original 4 h target — leave the default unless
  it shows the legacy 24 h, in which case set ≤ 14400 s. Note this is only
  a *backstop*: the real allow-list revocation path is the middleware
  re-check with a 60 s cache (§10.3), so a removed user is bounced within
  ~1 min regardless of JWT lifetime.

### 10.1.1 User offboarding — data deletion
Removing a row from `allowed_emails` blocks the user's next request
(§10.3). It does **not** delete their reports — and under the Privacy
Act 1988 a user can request deletion of personal information held
about them. An admin-only action `purgeUserData(userId)`:
1. Looks up the user's report ids.
2. Deletes the matching R2 objects.
3. Deletes `report_versions`, `report_node_artifacts`, `llm_calls`,
   `rate_limit_counters` rows.
4. **Hard-deletes** `reports` rows for that user (this is one of the
   few places we hard-delete; the `audit_log` retains the ID-only
   record of the purge).
5. Removes the `allowed_emails` row.
6. Calls `supabase.auth.admin.deleteUser(userId)`.

Wrapped in a single Postgres transaction (steps 3–5) with R2 deletions
(step 2) performed before the transaction commits — orphan R2 objects
are tolerable; orphan DB rows pointing to deleted PDFs are not. `[R50]`

### 10.2 Allow-list enforcement (callback)
```ts
// app/auth/callback/route.ts
const { data, error } = await supabase.auth.exchangeCodeForSession(code);
if (error) return redirect('/login?error=oauth');
const email = data.user.email!;
if (!(await isAllowed(email))) {
  await supabase.auth.signOut();
  return redirect('/login?error=not_allowed');
}
await upsertUser(email);
return redirect('/');
```

### 10.2.1 Inngest webhook signature verification
`/api/inngest` receives signed requests from Inngest. Verify every
request with `INNGEST_SIGNING_KEY` using `serve()` from the Inngest
SDK — it handles signature + replay-window checking. Reject unsigned
or stale (> 5 min skew) requests with 401. Without this, anyone on
the internet can fire `reports/generate.requested` and burn LLM budget
on our key. `[R45]`

### 10.2.2 Content Security Policy
A strict CSP is set on every HTML response from a Next.js middleware
header (matched on the same matcher as auth, since `/api/*` doesn't
serve HTML). `[R46]`

```
default-src 'self';
script-src 'self' 'nonce-{generated-per-request}';
style-src 'self' 'unsafe-inline';   // tailwind injects style attrs
img-src 'self' blob: data: https://*.domain.com.au https://*.mapbox.com
              https://maps.googleapis.com https://*.r2.cloudflarestorage.com;
font-src 'self';
connect-src 'self' https://*.supabase.co https://*.sentry.io
                   https://cloud.langfuse.com;
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
```

CSP violation reports POST to a Sentry endpoint so we see breakage.
Tighten over time once stable.

### 10.3 Route protection — Edge session gate + Node allow-list gate `[R5]`

> **Implementation reality (deviation from the original single-middleware
> design).** Next.js 15.0.3 middleware runs on the **Edge runtime**, which
> can't use `postgres-js` (needs Node TCP sockets). The allow-list lives in
> Postgres and we query it via Drizzle, so the DB re-check **cannot** run in
> middleware. We also don't use Supabase's Data API/PostgREST (§4.3), so
> `supabase.from('allowed_emails')` isn't available either. The original
> spec's `createMiddlewareClient` + in-middleware `isAllowedCached` is not
> achievable on this runtime. We split the concern into two gates — which is
> also what Supabase officially recommends (middleware = session refresh;
> authorization = elsewhere).

**Gate 1 — Edge middleware (`middleware.ts` + `src/lib/auth/middleware.ts`).**
Refreshes the Supabase session on every request via `getUser()` (an HTTPS
call to Supabase Auth — Edge-safe, and algorithm-agnostic so the 2025
JWT-signing-keys migration is transparent). Redirects unauthenticated traffic
to `/login`. No DB access. Matcher excludes `_next/*`, image/font assets, and
`api/inngest` (own signature auth, [R45]); `/login` and `/auth/*` are treated
as public inside the handler.

**Gate 2 — Node allow-list re-check (`requireAllowedUser()` in
`src/lib/auth/user.ts`).** Every protected Server Component / Server Action
calls this. It (a) confirms the session via `getUser()`, (b) re-checks the
allow-list through `isAllowedCached` (60 s TTL, Drizzle), (c) on failure
`signOut()` + `redirect('/login?error=not_allowed')`, (d) `upsertUser` and
returns the local `users.id`. This is the revocation path.

**Primary gate — `/auth/callback`.** The callback (§10.2) calls `isAllowed`
(uncached) before any session is usable. A de-listed account can never reach
an authenticated surface in the first place; Gate 2 only matters for
revoking an *already-signed-in* user, and does so within the 60 s cache
window on next navigation to a protected page.

`isAllowedCached` uses a 60-second in-memory TTL cache so revocations take
effect within a minute without hammering Postgres. The cache is per-process,
so on Vercel the effective revocation latency is "≤ 60 s per warm instance"
(§10.1). Unit-tested in `tests/unit/allowlist.test.ts`.

---

## 11. Rate limiting & cost ceiling

Three layers. **All required.**

### 11.1 Per-user daily report cap
- `DAILY_LIMIT = 20` reports / user / day.
- Counter in `rate_limit_counters(userId, day)`.
- **Increment only on successful generation (`status='succeeded'`).** Failed
  reports do not burn quota. `[R6]` (Original spec incremented up-front; a
  user with 20 unresolvable addresses lost the day.)

### 11.2 Per-report Domain API call ceiling
- `DOMAIN_CALLS_PER_REPORT = 50`.
- Tracked in `reportContext` (AsyncLocalStorage). Exceeding throws
  `DomainQuotaError` mid-graph.
- Prevents runaway loops costing real money.

### 11.3 Per-report LLM cost ceiling — **$10 USD** `[R2]`
- Ceiling raised from $5 to $10. Headroom for one revise loop on the hard
  path and for fallback to Claude.
- Cost accumulated in `reportContext.costUsd`. The check fires **at node
  boundaries** (before each LangGraph node starts), never mid-LLM-call —
  this avoids leaving a half-spent revise loop with an unrendered report.
- The pre-node check uses
  `currentCost + WORST_CASE_NODE_COST[node] > $10`, **not**
  `currentCost > $10`. Otherwise a 9-parallel compose starting at $9.50
  lands at $11+ before the next boundary fires. The
  `WORST_CASE_NODE_COST` table is the "Worst-case" column below; bumping
  any value requires a PR. `[R23]`
- **Cost reconstruction on Inngest step retry.** `reportContext.costUsd`
  is non-durable; on every Inngest step entry it is rehydrated with
  `SELECT coalesce(sum(cost_usd), 0) FROM llm_calls WHERE report_id = $1`.
  `llm_calls` rows are written *synchronously* inside `structuredCall`
  before the call returns, so it is the ledger of truth. Without this,
  the ceiling resets to $0 on every retry and a crash-looping worker
  could spend $10 per retry. `[R24]`
- If a node is about to push cost past $10 → graph aborts and the report
  is marked `failed` with `errorMessage = 'cost ceiling reached'`.

#### Per-node worst-case cost table (USD)
| Node | Typical | Worst-case | Notes |
|---|---|---|---|
| 01 resolveAddress | $0.00 | $0.00 | No LLM |
| 02 fetchSubject | $0.00 | $0.00 | No LLM |
| 03 fetchCandidateComps | $0.00 | $0.00 | No LLM |
| 04a visionSubject | $0.05 | $0.10 | Vision; 20 photos |
| 04b visionComps | $0.60 | $0.90 | 30 × ~$0.02 (15 photos worst) |
| 04c streetView | $0.02 | $0.04 | Vision on 4 stitched images |
| 05 planningAndNews | $0.01 | $0.04 | GPT-5-mini per DA classification |
| 06 reasonAndSelect | $0.50 | $1.20 | GPT-5 high reasoning over 30 comps |
| 07 triangulate | $0.06 | $0.12 | GPT-5 standard |
| 08 fetchRentals | $0.00 | $0.00 | No LLM |
| 09 fetchRisks | $0.00 | $0.00 | No LLM |
| 10 compose | $0.45 | $0.90 | 9 parallel GPT-5 standard |
| 11 critic (Pass 2) | $0.15 | $0.40 | GPT-5 standard |
| 12 revise × up to 2 | $0.30 | $1.40 | Re-runs the most expensive sections; rare |
| 13 render | $0.00 | $0.00 | Puppeteer |
| — OpenAI fallback to Claude (if triggered, adds) | — | +$0.80 | Worst-case for the failing node only |
| **Total** | **~$2.15** | **~$6.20 (single revise) → ~$8.00 (with fallback)** | Well inside $10 |

---

## 12. Inngest workflow

```ts
export const generateReport = inngest.createFunction(
  {
    id: 'reports/generate',
    retries: 1,
    // Two concurrency keys: a global cap so we don't blow up the worker
    // pool, AND a per-user cap so one agent can't monopolise the queue.
    // 4 global / 2 per-user fits 3 founding users comfortably. [R32]
    concurrency: [
      { scope: 'fn', limit: 4 },
      { scope: 'fn', key: 'event.data.userId', limit: 2 },
    ],
  },
  { event: 'reports/generate.requested' },
  async ({ event, step }) => {
    const { reportId, userId, address } = event.data;
    const ctx = { reportId, domainCalls: 0, costUsd: 0 };

    await step.run('mark-running', () => updateReport(reportId, { status: 'running' }));

    await reportCtx.run(ctx, async () => {
      // `graphSlice` rehydrates ctx.costUsd from llm_calls before entering
      // the slice's first node — see [R24]. This is what makes the cost
      // ceiling resilient to Inngest step retries.
      await step.run('S1-prepare',      () => graphSlice(reportId, 'S1'));
      await step.run('S2-fetch-fanout', () => graphSlice(reportId, 'S2'));
      await step.run('S3-vision-comps', () => graphSlice(reportId, 'S3'));
      await step.run('S4-reason',       () => graphSlice(reportId, 'S4'));
      await step.run('S5-compose',      () => graphSlice(reportId, 'S5'));
      await step.run('S6-render',       () => graphSlice(reportId, 'S6'));
    });

    await step.run('finalise', () => updateReport(reportId, { status: 'succeeded' }));
    await step.run('incr-quota', () => incrementDailyCounter(userId));    // §11.1
    await step.run('email-user', () => sendReadyEmail(userId, reportId));
  },
);
```

- `graphSlice(reportId, sliceId)` invokes the graph with the same
  `thread_id` (= `reportId`) and a `targetCheckpoint` config telling LangGraph
  which step's join node to stop at. `PostgresSaver` makes this resumable.
- **Vercel function timeout: Pro extends to 300 s.** No single step is
  budgeted past ~90 s, so a function timeout (which would kill the whole
  Inngest webhook handler) is recoverable: Inngest retries that step from
  its starting checkpoint.

---

## 13. PDF rendering

### 13.1 Approach
RSC → HTML → **Puppeteer via `@sparticuz/chromium` on Vercel**.

### 13.2 Why not `react-pdf`
`react-pdf` is faster but typographically limited and doesn't support print
CSS, custom fonts the way we want, or complex page-break logic.

### 13.3 Render flow
```ts
await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 60000 });
const pdf = await page.pdf({
  format: 'A4',
  printBackground: true,
  margin: { top: '15mm', right: '15mm', bottom: '20mm', left: '15mm' },
  displayHeaderFooter: true,
  footerTemplate: footerHtml,  // includes 'Powered by Domain' logo + page numbers
});
```

> The 60 s `setContent` timeout is why the S6 Inngest step budget
> (§6.4) is 75 s, not the 30 s in the original spec — anything tighter
> can't accommodate slow font/image fetches plus R2 upload plus the two
> DB writes that follow. The PDF render route's Vercel function memory
> must also be raised to 3008 MB (§16.2, `[R28]`).

### 13.4 Typography
- **Body:** Inter (free Google Font), self-hosted as woff2.
- **Display/headings:** **General Sans** (Indian Type Foundry, free for
  commercial use). **Replaces Söhne** to avoid the paid Klim licence. `[R11]`
- `tabular-nums` for all monetary values.
- Body 10 pt / line-height 1.45.
- Palette: neutral greys, single accent deep navy **`#1F3864`**. No gradients,
  no shadows.

### 13.5 Charts in the PDF
SSR SVG via **Observable Plot**, inlined at render time. Charts:
- Price-position dot plot (subject vs comps)
- Suburb 5-year median line
- DOM (Days On Market) histogram

---

## 14. Observability & error handling

### 14.1 Layers
- **Sentry** (`instrumentation.ts`) — uncaught exceptions, Vercel + edge.
  PII scrubbing extends pino's redaction set (§14.4) — `*.address`,
  `*.subjectAddress`, `state.subject`, `state.comparables`,
  `*.listing` — so breadcrumbs and stack frames don't leak listing data
  to Sentry's US/EU servers. `[R49]`
- **Langfuse** — `CallbackHandler` attached to LangGraph; one trace per report.
- **`llm_calls` table** — per-call ledger (provider, model, tokens, cost,
  latency, `langfuseTraceId`, `promptVersion`).
- **Vercel logs via pino** — INFO entries/exits, WARN retries, ERROR failures.
- **`audit_log` table** — append-only, never delete.

### 14.4 Alerts (operational, not just error-driven)
On top of Sentry's default exception alerting, three explicit signals
need their own channels (Sentry rules or a tiny Inngest cron that posts
to a Slack webhook): `[R33]`

1. **Daily cost summary** — every morning 09:00 AEST, post per-user +
   total spend from `llm_calls` for the prior calendar day. Flag any
   user > $50 / day (≈ 5 expensive reports) for review.
2. **Fallback firing rate** — alert if `provider='anthropic'` rows
   exceed 5% of total calls in a rolling hour (suggests OpenAI is
   degraded). Alert again on > 20% (suggests sustained outage —
   escalate).
3. **Cost-ceiling hits** — any `llm_calls`-aggregate run that exceeded
   $10 in the prior 24 h. One ceiling hit per week is acceptable; > 1
   per day suggests prompt regression.
4. **NSW VG ingest drift** — see §8.4 tripwires.
5. **Schema-drift on Domain** — any `DOMAIN_SCHEMA_DRIFT` error fires
   PagerDuty / Slack within 5 min (not just Sentry).

### 14.2 Error hierarchy
```ts
class AppError extends Error { code: string; details?: unknown; /* … */ }
class AddressResolutionError   extends AppError { /* ADDRESS_UNRESOLVED */ }
class UnsupportedRegionError   extends AppError { /* REGION_UNSUPPORTED */ }
class DomainQuotaError         extends AppError { /* DOMAIN_QUOTA_PER_REPORT */ }
class CostCeilingError         extends AppError { /* COST_CEILING */ }
class RateLimitError           extends AppError { /* RATE_LIMIT */ }
class PartialDataError         extends AppError { /* PARTIAL_DATA — non-fatal; tagged for Sentry */ }
```

### 14.3 Failure recovery
- Inngest step retries once; second failure → `status='failed'` +
  `emailErrorMessage` + email user.
- Checkpointed state remains in Postgres for postmortem inspection.
- `PartialDataError` is logged with breadcrumbs and the report continues in
  degraded mode (see §7.17).

---

## 15. UI specification

### 15.1 Pages
| Route | Component | Purpose |
|---|---|---|
| `/login` | `LoginPage` | Google OAuth button + allow-list error states |
| `/` | `Dashboard` | List + filter + search of user's reports |
| `/reports/new` | `NewReportForm` | Address input with Domain Address Suggestions autocomplete |
| `/reports/[id]` | `ReportDetail` | Live progress, then preview + actions (download PDF, regen). No "share" action in v1 — the signed-URL TTL + the allow-list make sharing outside the firm a separate design problem. |
| `/reports/[id]/pdf` | `PdfRouteHandler` | Redirects to fresh signed R2 URL |

### 15.1.1 Email-delivery status surfacing
The `email-user` Inngest step is independent of `status='succeeded'`
(see §12). If it exhausts retries, the report card on the dashboard
shows an **"email not delivered"** chip with a "Resend" affordance that
re-enqueues the same step. The report itself remains downloadable via
the UI regardless. New `reports.emailStatus enum {pending, sent,
failed}` column tracks this. `[R35]`

### 15.1.2 New Report dedupe dialog `[R51]`
The R2 PDF + Postgres `state` already act as the "cache" for any
previously-generated report; this is the UI surface that connects users
to it instead of re-spending $2–3 of LLM budget on a duplicate.

When a user picks an address in the New Report autocomplete, the form
fires `GET /api/reports/recent?propertyId=<domainPropertyId>`. The
handler returns the most-recent **firm-wide** `succeeded` *or*
`running` report for that `domainPropertyId` within the last 24h:

```ts
{ id: string, status: 'succeeded'|'running',
  createdAt: string, userEmail: string, version: number } | null
```

If non-null, a dialog blocks the "Generate" button:

- **`status='succeeded'`** — "A report for **\<address\>** was generated
  by **\<email or 'you'\>** \<relativeTime\>. Open the existing report
  or generate a fresh one?"
  Buttons: [**Open existing**] (primary, navigates to
  `/reports/{id}`) · [Generate new] (secondary, normal flow).
- **`status='running'`** — "**\<email\>** is currently generating a
  report for this property (started \<relativeTime\>)."
  Buttons: [**Wait for that report**] (primary, navigates to
  `/reports/{id}` showing the live progress stepper) ·
  [Generate new anyway] (secondary; warns about parallel Domain-quota
  consumption).

Design choices:
- **Firm-wide**, not per-user — all three founders are the same Domain
  licensee; saving spend across users matters more than per-user
  privacy on the dashboard (the dashboard remains per-user; the
  dialog only navigates).
- **24h window** chosen against the Domain FAQ data-churn rate
  (~4,000 listing updates/day across the group). Anything older than
  ~24h should be re-fetched.
- The query is **top-level-columns-only** (`domainPropertyId`,
  `status`, `createdAt`, `userId`) — passes the §4.3 / R26 ESLint
  rule without an allow-list exception.
- The user always retains the **"Generate new"** option; we don't
  silently replay stored `state`, which would deliver stale comps under
  a fresh timestamp (the failure mode the Domain "don't cache
  listings" guidance is designed to prevent).

### 15.2 Streaming progress UI
Polls `/api/reports/[id]` every 2 s while `status='running'`. Returns
`{ status, currentNode, percentage }`. A 13-node stepper renders user-friendly
labels: "Resolving address…", "Fetching property details…", "Finding
comparable sales…", "Analysing property photos…", "Analysing street view…",
"Pulling planning activity…", "Selecting best comparables…", "Triangulating
value…", "Fetching rentals…", "Assessing risks…", "Writing the report…",
"Reviewing for accuracy…", "Rendering PDF…".

### 15.3 Design language
**Linear-inspired.** Dense information, restrained colour, monospace for
IDs/timestamps. 8 px base spacing.
- Background `#FAFAFA / #FFFFFF`, text `#0A0A0A / #555`, accent `#1F3864`,
  error `#C9302C`.
- shadcn/ui base, Radix primitives directly when needed.
- **No emoji icons in the UI.** Use `lucide-react`.

---

## 16. Environment & deployment

### 16.0.1 API key rotation
All third-party API keys (`DOMAIN_API_KEY`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GOOGLE_MAPS_KEY`, `MAPBOX_TOKEN`, `RESEND_API_KEY`,
`R2_ACCESS_KEY`/`R2_SECRET_KEY`, `INNGEST_SIGNING_KEY`,
`SUPABASE_SECRET_KEY`) are rotated **quarterly** as a baseline
and **immediately** on any suspected leak. Procedure documented in
`docs/runbooks/key-rotation.md`:
1. Mint new key in the provider console.
2. Update Vercel env vars (preview first, then production).
3. Redeploy. Verify health checks.
4. Revoke old key in provider console.
5. Annotate the rotation in `audit_log` (with key name only — no
   secret material). `[R48]`

### 16.1 Environment variables (`.env.example`)
```bash
# Postgres — two connection strings
DATABASE_URL=postgresql://...?pgbouncer=true                # transaction mode (Next.js)
WORKER_DATABASE_URL=postgresql://...?pgbouncer=false        # session mode (Inngest worker, checkpointer, ingest)

# Supabase
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
# Note: new API key format (Supabase, early 2025). Replaces the legacy
# `anon` JWT (now → publishable) and `service_role` JWT (now → secret).
# `@supabase/supabase-js >= 2.45` and `@supabase/ssr >= 0.4` support both formats.

# Domain
DOMAIN_API_KEY=...
DOMAIN_STATS_CALLBACK_URL=...

# LLM
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
OPENAI_MODEL_REASONING=gpt-5-2026-XX-XX
OPENAI_MODEL_COMPOSE=gpt-5-2026-XX-XX
OPENAI_MODEL_MINI=gpt-5-mini-2026-XX-XX
OPENAI_MODEL_VISION=gpt-5-2026-XX-XX
ANTHROPIC_MODEL_FALLBACK=claude-sonnet-4-5-XX-XX

# Other APIs
MAPBOX_TOKEN=...
GOOGLE_MAPS_KEY=...

# Observability
SENTRY_DSN=...
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_BASE_URL=https://cloud.langfuse.com

# R2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
R2_BUCKET=reports

# Inngest
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=...

# Email
RESEND_API_KEY=...
```

### 16.2 Vercel project setup
- **Region:** `syd1`
- **Plan:** Pro (required for 300 s function runtime)
- Cron not used (Inngest handles)
- Edge Config not needed
- **`GOOGLE_MAPS_KEY`:** in Google Cloud Console, restrict by HTTP-referrer
  for browser usage and by IP for server-side usage (Vercel egress IPs).
  Without this, the key is harvestable from PDF asset URLs. `[R18]`
- **PDF render route memory.** Set the
  `src/app/reports/[id]/pdf/route.ts` function memory to **3008 MB** in
  `vercel.json`. The default 1024 MB will OOM on 6–10-page reports that
  embed Observable Plot SVGs and Street View imagery. Other routes stay
  at default. `[R28]`

### 16.3 Supabase project setup
- **Region:** `ap-southeast-2`
- PostGIS enabled
- **PgBouncer pooler enabled. Two connection strings:** `DATABASE_URL` uses
  **transaction mode** for the Next.js runtime (short-lived);
  `WORKER_DATABASE_URL` uses **session mode** for the Inngest worker
  (Drizzle + Postgres.js prepared statements need session mode). `[R17]`
- RLS not enabled (single tenant, application-level auth).
- **DR posture.** `[R36]`
  - **Postgres:** Supabase Pro provides 7-day Point-in-Time Recovery.
    Documented RTO is "≤ 4 hours, manual recovery via Supabase support."
    RPO ≤ 5 minutes for PITR. Acceptable for an internal 3-user tool.
  - **R2 PDFs:** R2 has no built-in cross-region backup. A weekly
    Inngest cron `r2BackupSnapshot` mirrors all `report_versions.pdfUrl`
    objects to a second R2 bucket in a different region (free egress
    between R2 buckets). RPO ≤ 7 days for PDF assets. The source-of-truth
    metadata (`report_versions` row) lives in Postgres, so re-rendering
    a lost PDF from `state` is also an option (within the 90-day
    `state`-retention window).
  - **Restore drill** — once before launch, restore a snapshot to a
    staging Supabase project and confirm `pnpm db:migrate` + login both
    work against it. Re-drill quarterly.

---

## 17. Build sequence (high-level)

> The full task-level expansion lives in **`docs/plan.md`**.

- **Phase A — Foundations:** repo scaffold, Supabase + Drizzle, OAuth +
  allow-list, observability, dashboard skeleton, CI, Vercel deploy.
- **Phase B — Tools layer:** Domain client + 9 wrappers + AsyncLocalStorage
  context, NSW VG ingest cron + WFS clients + Heritage + NSW Planning +
  council DA, Mapbox + Street View, LLM client.
- **Phase C — The graph:** state + checkpointer, nodes 01–13, end-to-end
  integration test, **resumption test** (kill worker mid-04b at 17/30).
- **Phase D — Rendering:** templates, print CSS, fonts, charts, static map,
  Puppeteer + R2 + signed-URL download.
- **Phase E — UI polish:** New Report form, live progress stepper, preview
  page with versioned regen, email notifications, dashboard filters/search.
- **Phase F — Hardening:** rate limit + cost ceiling enforced at node
  boundaries, per-error-class UX, audit-log writes, Domain TOS compliance
  (stats callback, attribution, UTM links), **Domain sign-off on
  snapshot-storage interpretation AND on OpenAI-vision transmission**, first
  live runs with each of the three users.

---

## Appendix A — Domain Listings `_search` request example

```http
POST https://api.domain.com.au/v1/listings/residential/_search
{
  "listingType": "Sold",
  "propertyTypes": ["House"],
  "minBedrooms": 3,
  "maxBedrooms": 4,
  "minBathrooms": 1,
  "locations": [
    { "state": "NSW", "suburb": "Mosman", "postCode": "2088",
      "includeSurroundingSuburbs": false }
  ],
  "updatedSince": "2025-11-25T00:00:00Z",
  "pageSize": 50,
  "sort": { "sortKey": "DateUpdated", "direction": "Descending" }
}
```
> Mosman LGA does **not** have a supplementary council DA JSON feed. Phase 1
> either: (a) accepts Mosman in degraded mode for planning (NSW Portal
> metadata only), or (b) the LGA gate rejects it. **Default in v1 is (a).**

---

## Appendix B — Node 06 output schema (`ReasonSelect`)

```ts
const Adjustment = z.object({
  dimension: z.string(),                  // e.g. 'land-area', 'condition', 'aspect'
  delta: z.number().min(-0.30).max(0.30), // % as decimal
  rationale: z.string().min(20),
  sourceRef: SourceRefSchema,
});

const ComparableDecision = z.object({
  compId: z.string(),
  selection: z.enum(['fair-value','negotiation-anchor','rejected','candidate']),
  rejectionReason: z.string().nullable(),
  adjustments: z.array(Adjustment).max(8),
  adjustmentNarrative: z.string().min(60),
  adjustedValue: z.number(),
  selectionRationale: z.string().min(40),
});

export const ReasonSelectOutput = z.object({
  decisions: z.array(ComparableDecision),
});
```

---

## Appendix C — Summary of refinements applied in v1.1

| # | Refinement | Affected sections |
|---|---|---|
| R1 | Inngest steps + per-item idempotency + resumption contract | §6.4, §7.5, §7.11, §12, Phase C |
| R2 | Cost ceiling raised to $10 + per-node cost table + abort-between-nodes only | §11.3 |
| R3 | Domain TOS guardrails: role + lint rule + retention + OpenAI-vision flag | §4.3, §8.3, Phase F |
| R4 | Structured `ClaimBlock`s replace free prose + regex critic | §5, §7.12, §7.13 |
| R5 | Allow-list re-checked in middleware (60 s cache); JWT 4 h | §10.1, §10.3 |
| R6 | Rate-limit counter incremented only on success | §11.1 |
| R7 | Versioning rules explicit; `report_versions` table | §4.2, §7.16 |
| R8 | Partial-data / graceful-degradation policy | §7.17, §14 |
| R9 | All deps pinned; model IDs in env; puppeteer/chromium pair-pin | §2.2, §9.1, §16.1 |
| R10 | Council DA feed coverage + degraded mode for unsupported LGAs | §1.3, §7.7 |
| R11 | Söhne replaced with General Sans (free) | §13.4 |
| R12 | Flood: WFS chosen over SES API | §7.11 |
| R13 | Per-agency underquote signal dropped from v1 | §5 |
| R14 | Triangulate weights sum-to-1 constraint enforced | §7.9 |
| R15 | Fallback retry contract resolved (single outer try) | §9.1, §9.2 |
| R16 | AsyncLocalStorage for per-report quota + cost | §3, §8.1, §12 |
| R17 | Two Postgres connection strings: transaction + session mode | §3, §16.3 |
| R18 | Google Maps key restriction step | §8.5, §16.2 |
| R19 | AU-data-residency goal removed | (was Phase F) |
| R20 | Merge-by-key reducers for `comparables` / `risks` / `prose` | §6.1 |
| R21 | `report_node_artifacts` side table — mid-node durability | §4.2, §6.3, §7.5, §7.11, §7.12 |
| R22 | `SourceRef.path` (JSON Pointer) required for deterministic critic | §5.1, §7.13 |
| R23 | Cost ceiling: pre-node check uses worst-case-per-node table | §11.3 |
| R24 | Cost reconstruction from `llm_calls` on Inngest step retry | §11.3, §12 |
| R25 | `reports.subjectAddress` denormalised — no JSONB cross-row queries | §4.2, §15 |
| R26 | `api_reader` role framed as defense-in-depth, not primary control | §4.3 |
| R27 | Package name corrected: `@observablehq/plot` (not `@plot/plot`) | §2.2 |
| R28 | PDF render route gets 3008 MB on Vercel | §13.3, §16.2 |
| R29 | `reviseIterations` incremented + recorded before regeneration | §7.14 |
| R30 | Prompt versioning + regression baseline pin | §9.3 |
| R31 | NSW VG quantitative drift tripwires (row count, suburb count, recency, null-rate) | §8.4 |
| R32 | Per-user Inngest concurrency cap (2/user, 4 global) | §12 |
| R33 | Operational alerts (daily cost, fallback rate, ceiling hits, drift) | §14.4 |
| R34 | Both-providers-down → `LlmProvidersUnavailableError`, quota preserved | §9.1 |
| R35 | Email-delivery failure surfaced + resend affordance | §15.1.1 |
| R36 | DR posture: Supabase PITR + R2 weekly mirror + restore drill | §16.3 |
| R37 | Domain stats callback retry queue (Inngest cron + backoff) | §8.3 |
| R38 | Server-side stats fire at PDF render time | §8.3 |
| R39 | Per-listing attribution in PDF body (not just footer) | §8.3 |
| R40 | NSW VG vs Domain sale tiebreaker (NSW VG price; Domain attrs) | §7.3 |
| R41 | NSW VG non-arms-length outlier filter | §8.4 |
| R42 | Vision-output enums frozen at Zod boundary | §7.4 |
| R43 | Domain AVM confidence propagated to triangulation | §7.9 |
| R44 | Triangulation divergence guardrail (spread > 0.25 forces low-confidence) | §7.9 |
| R45 | Inngest webhook signature verification | §10.2.1 |
| R46 | Content-Security-Policy headers | §10.2.2 |
| R47 | PDF downloads proxied through server, no signed-URL leakage | §7.15 |
| R48 | Quarterly API key rotation runbook | §16.0.1 |
| R49 | Sentry PII scrubbing for address / state / listing fields | §14.1 |
| R50 | User offboarding deletion path (`purgeUserData`) | §10.1.1 |
| R51 | Firm-wide 24h dedupe dialog at New Report (`domainPropertyId` denormalised) | §4.2, §15.1.2 |
