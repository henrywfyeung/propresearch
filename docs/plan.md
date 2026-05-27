# Implementation Plan — AI Property Due-Diligence Platform

> **Audience:** Claude Code / contributors. This plan expands §17 of the
> refined engineering spec into a concrete, sequenced build. Every refinement
> (`[Rxx]`) from the spec is mapped to the phase / task that lands it.
>
> **Source of truth for the design itself: `../CLAUDE.md`.** This document is
> purely "how to build it, in what order, with what acceptance criteria".

## How to read this plan

- Phases are **strictly ordered**: A → B → C → D → E → F.
- Within a phase, tasks numbered `Pn.m` are ordered by recommended sequence.
  Where parallelism is safe, that's called out.
- Every task has:
  - **Files** — concrete paths under `src/` (mirrors §3 repo layout).
  - **What** — the actual work.
  - **Acceptance** — observable, testable criteria. Don't mark done without
    these.
  - **Refinements** — `[Rxx]` tags from the spec that this task implements,
    so nothing slips through.
- Every phase ends with a **Phase exit gate** — a verification step that
  must pass before the next phase starts.

## Conventions
- All Zod boundaries → use `safeParse` and **throw a typed `AppError`** with
  the failing path included.
- Every external call → `pRetry` with the params in §8.1.
- Every LLM call → goes through `structuredCall` / `callWithFallback`
  (§9.2); inserts a `llm_calls` row; emits a Langfuse trace.
- All money values stored in DB as `numeric(10,4)` (reports) or `numeric(10,6)`
  (per LLM call).
- Don't add a dep without pinning it exactly and updating `CLAUDE.md` §2.2.

---

# Phase A — Foundations

**Goal:** repo deploys to Vercel `syd1`; a logged-in allow-listed user can
visit an empty dashboard. Observability is live. CI is green.

## A1. Repo scaffold

**Files:** root `package.json`, `tsconfig.json`, `next.config.ts`, `biome.json`,
`vitest.config.ts`, `tailwind.config.ts`, `postcss.config.js`,
`src/app/layout.tsx`, `src/app/page.tsx`.

**What:**
1. `pnpm dlx create-next-app@15.0.3` with App Router + TypeScript + Tailwind.
2. Pin **every** dep exactly (`pnpm add -E …`) to the versions in CLAUDE.md §2.2.
3. `tsconfig.json`: `"strict": true, "noUncheckedIndexedAccess": true,
   "module": "esnext", "target": "ES2023"`.
4. Biome config: format on save, lint on commit.
5. Set up `pnpm` scripts: `dev`, `build`, `start`, `lint`, `test`, `test:int`,
   `db:generate`, `db:migrate`, `db:push`.
6. Add `.nvmrc` → `22`.

**Acceptance:**
- `pnpm install` runs clean with **no version ranges** in `package.json`
  (`"^" "~"` forbidden — enforce in CI with a grep step).
- `pnpm build && pnpm start` serves an empty home page locally.
- `pnpm test` runs Vitest with zero tests and exits 0.

**Refinements:** `[R9]` (deps pinned).

## A2. Supabase + Postgres + PostGIS + Drizzle

**Files:** `src/db/schema.ts`, `src/db/client.ts`, `src/db/client-worker.ts`,
`src/db/migrations/`, `drizzle.config.ts`.

**What:**
1. Create Supabase project in **`ap-southeast-2`** (Pro plan).
2. Enable PostGIS + uuid-ossp via SQL editor (run the two `CREATE EXTENSION`
   statements from CLAUDE.md §4.1).
3. Enable PgBouncer pooler. Capture **two** connection strings:
   - `DATABASE_URL=…?pgbouncer=true` (transaction mode)
   - `WORKER_DATABASE_URL=…?pgbouncer=false` (session mode)
4. Write `src/db/schema.ts` with all tables from CLAUDE.md §4.2:
   `users`, `allowed_emails`, `reports` (with `subjectAddress text` —
   `[R25]`, `domainPropertyId text` — `[R51]`, and
   `emailStatus enum {pending, sent, failed}` — `[R35]`),
   `audit_log`, `nsw_vg_sales`, `llm_calls`,
   `rate_limit_counters`, `report_versions`, `report_node_artifacts`
   (PK `(reportId, node, itemKey)`, `payload jsonb`, `costUsd
   numeric(10,6)`, `revisionRound int default 0`, `createdAt`) — `[R21]`,
   `pending_stats_callbacks(listingId, payload, attempts,
   nextAttemptAt, createdAt)` — `[R37]`.
5. Add explicit indexes:
   - `nsw_vg_sales`: GIST on `geom`, btree on `(suburb, postcode)`, btree on
     `contract_date`.
   - `reports`: btree on `(userId, createdAt desc)`, partial index on
     `status='running'`, trigram index on `subjectAddress` for ILIKE
     search in the dashboard (E5) — `[R25]`, and a partial index on
     `(domainPropertyId, createdAt DESC) WHERE status IN
     ('succeeded','running')` for the dedupe lookup — `[R51]`.
   - `report_node_artifacts`: PK `(reportId, node, itemKey)` already
     covers lookup-by-(report, node); no extra indexes needed.
   - `pending_stats_callbacks`: btree on `nextAttemptAt` (cron drains
     by next-attempt time).
6. Wire `src/db/client.ts` (txn-mode pool, used by Next.js server actions /
   route handlers) and `src/db/client-worker.ts` (session-mode pool, used by
   Inngest functions and the checkpointer).
7. Generate + apply the first migration via `drizzle-kit`.
8. **Create the `api_reader` Postgres role.** No DDL, no `SELECT` on
   admin/ingest tables, no write on `nsw_vg_sales`. Treat this as
   *defense-in-depth*, not the primary control on cross-row queries —
   the ESLint rule in A6 is the primary control. `[R26]`

**Acceptance:**
- `pnpm db:migrate` is idempotent (run twice → no diff).
- Connecting via either URL works in Node:
  ```bash
  psql "$DATABASE_URL" -c "select postgis_version();"
  psql "$WORKER_DATABASE_URL" -c "select postgis_version();"
  ```
- `select count(*) from reports;` works as `api_reader`; arbitrary
  `select state -> 'comparables' from reports` does **not**.

**Refinements:** `[R3]` (api_reader role), `[R7]` (report_versions),
`[R17]` (two connection strings), `[R21]` (`report_node_artifacts`
table), `[R25]` (`subjectAddress` column + trigram index),
`[R26]` (api_reader as defense-in-depth).

## A3. Auth: Supabase + Google OAuth + allow-list

**Files:** `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`,
`src/lib/auth/allowlist.ts`, `src/lib/auth/server.ts`, `middleware.ts`.

**What:**
1. Supabase dashboard → Auth → enable Google provider; set OAuth redirect
   URLs to **production + `http://localhost:3000`**.
2. **JWT expiry: 4 hours** (was the default 24 h). `[R5]`
3. Build `/login` with a Google "Sign in" button (shadcn).
4. Auth callback: implement the exchange + allow-list check + `upsertUser` as
   in CLAUDE.md §10.2. On failure, `signOut` + redirect to
   `/login?error=not_allowed`.
5. `isAllowed(email)`: simple `select 1 from allowed_emails where email = $1`.
6. `isAllowedCached(email)`: **60-second TTL in-memory cache** (LRU keyed on
   email). Document the rationale: revocation visible within 1 min, no
   per-request Postgres hit.
7. `middleware.ts` (Next.js root) implements the matcher + per-request
   re-check from CLAUDE.md §10.3 (excludes `_next/static`, `_next/image`,
   `favicon`, `public`, `login`, `api/inngest`).
8. Seed `allowed_emails` with the three founding agents.

**Acceptance:**
- Non-allow-listed Google account → blocked at callback, sees the error chip
  on `/login`.
- Allow-listed user → lands on `/` and `session.user.email` is populated.
- Deleting a row from `allowed_emails` while a session is active → the next
  navigation within ≤ 60 s redirects back to `/login`.

**Refinements:** `[R5]` (middleware re-check + 60 s cache + 4 h JWT).

## A4. Observability wiring

**Files:** `instrumentation.ts`, `src/lib/observability/sentry.ts`,
`src/lib/observability/langfuse.ts`, `src/lib/observability/logger.ts`.

**What:**
1. `@sentry/nextjs` — `instrumentation.ts` registers both `nodejs` and
   `edge` runtimes. DSN from env. `tracesSampleRate: 0.2`.
2. `Langfuse` client + `CallbackHandler` factory keyed on `reportId` so each
   report has one trace.
3. `pino` logger with redaction for `*.api_key`, `*.token`, `authorization`.
4. Wire pino into a tiny middleware that logs request-id + path + status +
   latency.

**Acceptance:**
- Force a 500 in a dev route → Sentry receives the event with environment
  tags `vercel-env`, `release`, `region=syd1`.
- A test `structuredCall` shows up in Langfuse under a parent trace named
  `report:<uuid>`.

## A5. Dashboard skeleton

**Files:** `src/app/page.tsx`, `src/components/ReportListEmpty.tsx`,
`src/components/AppNav.tsx`.

**What:**
- Server component fetches `select * from reports where userId = $1 order by
  createdAt desc limit 50` via `db/client.ts`.
- If 0 rows → empty state with CTA "Create new report" (routes to
  `/reports/new`, stub for now).
- Top nav: brand wordmark + user menu (sign out).

**Acceptance:** logged in → page renders in < 500 ms with no console errors.

## A5.1 Security headers + Inngest webhook signing

**Files:** `middleware.ts` (CSP), `src/app/api/inngest/route.ts`,
`src/lib/security/csp.ts`.

**What:**
1. CSP middleware emits the policy from CLAUDE.md §10.2.2 with a
   per-request nonce. Violations POST to a Sentry CSP-report
   endpoint. `[R46]`
2. `/api/inngest` uses Inngest SDK's `serve()` with the
   `INNGEST_SIGNING_KEY` env var — that handles signature + 5-minute
   replay-window enforcement. Add an integration test that hits the
   webhook without a signature and asserts 401. `[R45]`

**Acceptance:**
- Browser devtools shows CSP headers on every HTML response; an
  inline script without a nonce is blocked.
- `curl -X POST /api/inngest -d '{}'` → 401.

## A6. Custom ESLint rule + CI + Vercel deploy

**Files:** `eslint-rules/no-unkeyed-reports-query.ts`, `.github/workflows/ci.yml`,
`vercel.json` (if needed for region pinning).

**What:**
1. Write a tiny ESLint rule that fails any `db.select(...).from(reports)`
   whose chain references `reports.state` without a
   `.where(eq(reports.id, …))` predicate. Queries that touch only
   top-level denormalised columns (`status`, `createdAt`, `userId`,
   `subjectAddress`) are allowed. **No allow-list comments override
   this** — if you need cross-row search, denormalise the column.
   **Required for `[R3]` / `[R25]` / `[R26]`.**
2. CI workflow on PR + main:
   - `pnpm install --frozen-lockfile`
   - `pnpm lint` (includes the custom rule)
   - `pnpm exec tsc --noEmit`
   - `pnpm test`
   - **grep step: fail if `package.json` contains `"^"` or `"~"` in deps**
3. Connect repo to Vercel → set region `syd1`, plan Pro, add all envs from
   CLAUDE.md §16.1. Promote main → production on green CI.

**Acceptance:**
- A PR that adds `db.select().from(reports)` without an id predicate fails
  CI with a clear error message pointing to the offending line.
- Pushing to `main` redeploys; the production URL loads `/login`.

**Refinements:** `[R3]` (lint rule), `[R9]` (no version ranges in CI).

---

### Phase A exit gate
- [ ] CI green on `main`.
- [ ] Production URL serves `/login`; OAuth works for an allow-listed user.
- [ ] Sentry + Langfuse receive test events from production.
- [ ] `drizzle-kit` migrations applied cleanly to Supabase prod.
- [ ] `api_reader` role exists; arbitrary `state`-JSONB queries are rejected.

---

# Phase B — Tools layer

**Goal:** every external integration the graph will touch is wrapped, typed,
Zod-validated, retried, and unit-tested behind MSW. The LLM client supports
fallback. **No graph yet.**

## B1. Domain client + AsyncLocalStorage context

**Files:** `src/agents/reportContext.ts`, `src/tools/domain/client.ts`,
`src/tools/domain/types.ts`.

**What:**
1. `reportContext.ts` — the AsyncLocalStorage holder from CLAUDE.md §8.1.
   Shape: `{ reportId: string, domainCalls: number, costUsd: number }`.
2. `domainCall<T>(endpoint, params, schema, opts)`:
   - `pRetry` with `{ retries: 4, minTimeout: 1000, maxTimeout: 10000,
     factor: 2 }`; retry only on 429 + 5xx.
   - Bearer token from `DOMAIN_API_KEY`.
   - Zod-validates the response; throws `AppError('DOMAIN_SCHEMA_DRIFT', …)`
     on mismatch.
   - Reads `reportCtx.getStore()`. Increments `domainCalls`. Throws
     `DomainQuotaError` past `DOMAIN_CALLS_PER_REPORT = 50`.
   - Optional `cacheKey` for **in-process memo only** (Map per AsyncLocalStorage
     context). Never cross-request.

**Acceptance:**
- Unit test: 51st call inside one `reportCtx.run(…)` throws `DomainQuotaError`.
- Unit test: a 503 response is retried; a 400 is not.
- Unit test: schema drift throws `DOMAIN_SCHEMA_DRIFT` with the failing path.

**Refinements:** `[R16]` (AsyncLocalStorage).

## B2. Domain endpoint wrappers (9 of them)

**Files:** `src/tools/domain/addressSuggestions.ts`,
`src/tools/domain/getProperty.ts`, `src/tools/domain/getPriceEstimate.ts`,
`src/tools/domain/getRentalEstimate.ts`,
`src/tools/domain/searchListingsSold.ts`,
`src/tools/domain/searchListingsRent.ts`,
`src/tools/domain/suburbStats.ts`,
`src/tools/domain/auctionResults.ts`,
`src/tools/domain/schools.ts`.

**What:** one file per wrapper from the §8.2 table. Each exports a typed
function and a Zod schema. Each uses `domainCall`.

**Acceptance:**
- MSW handlers in `tests/unit/domain/*.test.ts` exercise:
  - happy path → typed object back
  - 429 → retried with backoff
  - schema drift → typed error

## B3. NSW VG ingest (cron)

**Files:** `src/inngest/functions/nswVgIngest.ts`,
`src/tools/nsw-vg/resolvePsiUrl.ts`, `src/tools/nsw-vg/parsePipe.ts`,
`src/tools/nsw-vg/upsert.ts`.

**What:**
1. Inngest cron `TZ=Australia/Sydney 0 6 * * 2`.
2. `resolveLatestPsiUrl()` — fetch the published PSI page, regex-match the
   ZIP filename pattern, return the absolute URL. **Schema-fragile.**
3. Stream-download with `node:https` → unzip in-memory (use `node-stream-zip`
   or `unzipper`).
4. Pipe-delimited ASCII parser → typed rows.
5. Upsert into `nsw_vg_sales` via Drizzle (PostGIS `ST_MakePoint(lng, lat)`
   for `geom`). Composite PK `(propId, contractDate)` → use `ON CONFLICT
   DO UPDATE`.
6. After the upsert batch: `REINDEX INDEX nsw_vg_sales_geom_idx`.
7. **Quantitative drift checks** (`[R31]`) — at end of each run,
   compare with the prior week's stats and raise `SchemaDriftAlert` to
   Sentry + Slack if any check fails: row-count delta > ±25%, distinct
   suburbs < 200, no sales in last 14 days, > 1% null-rate on
   `propId / contractDate / purchasePrice / district`. URL-pattern
   throw still fires its own alert.
8. **Outlier filter** (`[R41]`) — drop rows that are not arms-length:
   `purchasePrice < $10,000` (family transfers), `nature_of_property =
   'Vacant Land'` when subject suburb has < 5 vacant-land sales/year
   (likely off-market), and any explicit `dealing_type` flagged as
   "non-arm's-length" by NSW VG metadata. Document the rules in a
   commented module so they're reviewable.

**Acceptance:**
- Local dry-run on a fixture ZIP inserts the expected count of rows.
- Re-running the function is idempotent (no growth).
- Killing the process mid-stream and re-running completes cleanly.
- Drift unit test: feed a fixture with `0` recent contract dates →
  `SchemaDriftAlert` fires; with healthy distribution → no alert.
- Outlier filter unit test: a fixture row with `purchasePrice = 1`
  is dropped, not upserted.

## B4. Planning + risks WFS / API clients

**Files:** `src/tools/planning/nswPlanning.ts`,
`src/tools/planning/councilDa/{sydneyCity,innerWest,randwick,waverley}.ts`,
`src/tools/planning/lgaGate.ts`, `src/tools/overlays/flood.ts`,
`src/tools/overlays/bushfire.ts`, `src/tools/overlays/heritage.ts`,
`src/tools/overlays/noise.ts`.

**What:**
1. NSW Planning Portal API client → returns metadata-level DA list within
   500 m / 12 months around a lat/lng.
2. Four supplementary council JSON feeds. Each normalises into a common
   `RecentDA` shape.
3. `lgaGate.ts`: given an LGA → returns `'supported' | 'metadata-only'`.
   Used by Node 05.
4. Flood: NSW Spatial Services flood WFS (`[R12]` — **WFS, not SES**).
5. Bushfire: NSW RFS Bushfire Prone Land WFS.
6. Heritage: NSW Heritage Register API.
7. Noise: distance heuristics from rail / airports / motorways via the
   pre-ingested Geoscape layer.

**Acceptance:** unit tests for each return a typed `RiskFlag[]` or
`RecentDA[]` against a fixture response. Each handles "no features at point"
without throwing.

**Refinements:** `[R10]` (LGA gate + metadata-only mode), `[R12]` (flood WFS).

## B5. Mapbox + Google Street View tools

**Files:** `src/tools/mapbox/geocode.ts`, `src/tools/streetview/url.ts`,
`src/tools/streetview/fetch.ts`.

**What:**
1. Mapbox geocoding fallback: `forwardGeocode(address) → { lat, lng,
   confidence }`. Used by Node 01 when Domain suggestion confidence is too
   low.
2. Street View URL builder from CLAUDE.md §8.5.
3. Fetch helper that returns four `Buffer`s for headings `[0, 90, 180, 270]`.
   On `return_error_code=true` with a no-imagery response, returns `null` for
   that heading.
4. **Restrict `GOOGLE_MAPS_KEY`** in GCP console: HTTP-referrer for browser,
   IP for server (Vercel egress IPs). `[R18]`

**Acceptance:** integration test against a known Sydney lat/lng pulls four
PNGs and a known no-imagery point returns at least one `null`.

## B6. LLM client (`structuredCall` + `callWithFallback`)

**Files:** `src/tools/llm/structuredCall.ts`, `src/tools/llm/anthropic.ts`,
`src/tools/llm/costs.ts`, `src/tools/llm/types.ts`.

**What:**
1. `structuredCall<T>` against OpenAI with:
   - Pinned model id from env (`OPENAI_MODEL_*`).
   - `reasoning_effort` pass-through.
   - Zod schema → strict structured output via the OpenAI Responses API.
   - `pRetry` for transient (5xx, 429, timeout).
   - On success: **insert the `llm_calls` row synchronously, before the
     call returns** (the table is the ledger of truth for cost
     reconstruction — `[R24]`). Then emit the Langfuse span. Then add
     `costUsd` to `reportCtx.getStore().costUsd`.
2. `callWithFallback<T>` — single outer try (CLAUDE.md §9.2 / `[R15]`); on
   failure logs WARN + calls `structuredCallAnthropic` with
   `ANTHROPIC_MODEL_FALLBACK`. If Anthropic also fails, throw
   `LlmProvidersUnavailableError` (`LLM_PROVIDERS_UNAVAILABLE`) — the
   Inngest step's standard one-retry handles the transient case; on
   second failure the report goes to `failed` *without* burning the
   user's daily quota. `[R34]`
3. `costs.ts` — pure function `estimateCostUsd({ model, promptTokens,
   completionTokens })`. Driven by a small static table keyed on model id;
   updates need a PR. Also exports `WORST_CASE_NODE_COST` — the
   `Worst-case` column from CLAUDE.md §11 — for the pre-node cost
   ceiling check (`[R23]`, wired in C8).
4. `rehydrateCostUsd(reportId)` — `SELECT coalesce(sum(cost_usd), 0)
   FROM llm_calls WHERE report_id = $1`. Called by `graphSlice(...)` at
   every Inngest step entry to repopulate the in-memory counter. `[R24]`
5. **Prompt versioning.** Each prompt module in `src/prompts/` exports
   a `version: string` const. `structuredCall` accepts it and writes
   it to `llm_calls.prompt_version` and as a Langfuse tag. The Node 06
   regression test (C5) pins the expected version and fails if the
   module bumps it without a re-baselined fixture. `[R30]`

**Acceptance:**
- Unit test: a `schema.safeParse` failure on the first attempt of
  `structuredCall` triggers `callWithFallback` exactly once.
- Unit test: cost accumulator inside `reportCtx.run` increments by the
  estimator's value on each successful call, and the matching
  `llm_calls` row is visible in the DB **before** the in-memory counter
  is updated (assert by stubbing the DB write and confirming the
  counter doesn't move when the write throws).
- Unit test: `rehydrateCostUsd` returns `0` for an unknown report and
  the exact sum for a report with three seeded `llm_calls` rows.

**Refinements:** `[R9]` (model IDs in env), `[R15]` (fallback contract),
`[R23]` (`WORST_CASE_NODE_COST` exported), `[R24]` (synchronous
`llm_calls` writes + `rehydrateCostUsd`).

## B7. Unit tests across the tools layer

**Files:** `tests/unit/similarity.test.ts`,
`tests/unit/triangulateWeights.test.ts`, `tests/unit/claimRender.test.ts`.

**What:**
1. **Similarity scoring** (CLAUDE.md §7.3) — golden tests for: same-suburb
   identical comp scores 100; > 30-week-old comp loses 30; far comp loses 25;
   wrong property type loses 20; etc.
2. **Triangulate weights sum-to-1** — fuzz test: random weight maps that
   sum within ±0.01 pass; outside fail. `[R14]`
3. **Claim render** — `renderClaim('Estimated value {{lo}}–{{hi}}', { lo:
   1_200_000, hi: 1_350_000, format: 'currency-aud' })` →
   `'Estimated value $1,200,000–$1,350,000'` with NBSP between symbol and
   amount; `tabular-nums` class applied.

**Acceptance:** `pnpm test` runs all three suites green.

---

### Phase B exit gate
- [ ] Every Domain wrapper has an MSW unit test for happy + 429 + schema drift.
- [ ] NSW VG ingest, run manually against a fixture ZIP, completes
      idempotently.
- [ ] WFS / Heritage / NSW Planning / 4 council feeds each return typed
      results against fixtures.
- [ ] `structuredCall` + `callWithFallback` covered by tests, including the
      fallback path.
- [ ] Similarity + weight + claim-render unit tests green.

---

# Phase C — The graph

**Goal:** end-to-end JSON state for a real Sydney address, with the
resumption contract proven.

## C1. State + checkpointer

**Files:** `src/schemas/state.ts`, `src/agents/state.ts`,
`src/agents/checkpointer.ts`.

**What:**
1. Implement every type from CLAUDE.md §5 as Zod schemas + inferred TS types.
   `SourceRef` (with the required `path` JSON Pointer field — `[R22]`),
   `Sourced<T>`, `ResolvedAddress`, `SubjectProperty`, `Comparable`,
   `MarketContext`, `RiskFlag`, `TriangulatedValue`, `RentalEvidence`,
   `NegotiationPack` (no `underquoteSignal` — `[R13]`), `ClaimBlock`
   (discriminated union), `ReportProse`, `CriticFinding`, `ReportState`.
2. `TriangulatedValueSchema` enforces weights sum-to-1.0 with `z.refine`.
3. `Annotation.Root` with the reducers from §6.1:
   - `comparables` — **merge-by-key on `id`** (`[R20]`). Provide a
     `mergeByKey('id')` helper in `src/agents/state.ts`.
   - `risks` — merge-by-key on `category`.
   - `prose` — merge-by-key on `sectionId`.
   - `criticFindings` — replacement (each pass replaces the set).
   - `errors`, `llmCalls` — append.
4. Add a small JSON-Pointer helper `resolvePointer(state, pointer)` used
   by the critic in C7 to look up the canonical value for any
   `sourceRef.path`. Throws a typed `PointerUnresolvedError` if the
   pointer doesn't land on a value. `[R22]`
5. `PostgresSaver.fromConnString(WORKER_DATABASE_URL)`. Call `.setup()`
   once at module init.
6. **Mid-node artifact helpers** in `src/agents/artifacts.ts`:
   - `loadArtifacts(reportId, node) → Map<itemKey, payload>` — hydrates
     completed items at node entry.
   - `saveArtifact(reportId, node, itemKey, payload, costUsd, revisionRound?)`
     — single-row insert in its own short transaction.
   Used by C3/C4/C7. `[R21]`

**Acceptance:**
- Round-trip: `JSON.parse(JSON.stringify(state))` re-parses via
  `ReportState.parse(...)` without loss.
- Sum-to-1 refine rejects weights summing to 0.98.
- A `SourceRef` without `path` fails Zod parse (regression for `[R22]`).
- `mergeByKey('id')` unit test: applying `[{id:'a', x:1}]` over
  `[{id:'a', x:0, y:9}, {id:'b'}]` yields `[{id:'a', x:1, y:9}, {id:'b'}]`
  (per-field LWW, untouched entries preserved).
- `resolvePointer` returns the correct value for nested paths and
  throws `PointerUnresolvedError` for unknown paths.

**Refinements:** `[R4]` (ClaimBlock), `[R13]` (no underquoteSignal),
`[R14]` (weights sum), `[R17]` (worker URL), `[R20]` (merge-by-key
reducers), `[R21]` (artifact helpers), `[R22]` (`SourceRef.path` +
`resolvePointer`).

## C2. Nodes 01–03 + integration test

**Files:** `src/agents/nodes/01_resolveAddress.ts`,
`src/agents/nodes/02_fetchSubject.ts`,
`src/agents/nodes/03_fetchCandidateComps.ts`,
`tests/integration/nodes-01-03.test.ts`.

**What:**
1. **01 resolveAddress:** Domain Address Suggestions; on low confidence,
   Mapbox fallback. Reject non-`{NSW,VIC,WA}` with
   `UnsupportedRegionError`. Phase 1 LGA gate enforced via §7.7's
   `lgaGate.ts`.
2. **02 fetchSubject:** in parallel — `getProperty`, `getPriceEstimate`,
   `searchListingsSold` (current listing). Zod-validates and assembles
   `SubjectProperty`.
3. **03 fetchCandidateComps:** Tier 1 Domain + Tier 2 NSW VG (PostGIS
   `ST_DWithin`), dedupe by address, score with §7.3 similarity, keep top
   30.

**Acceptance:**
- Integration test with a real Sydney address (e.g., a known sold listing)
  emits a `state` with 30 comps and a populated `subject.domainAvm`.
- An out-of-state address throws `UnsupportedRegionError`.

## C3. Nodes 04a / 04b / 04c — vision

**Files:** `src/agents/nodes/04a_visionAnalyseSubject.ts`,
`src/agents/nodes/04b_visionAnalyseComps.ts`,
`src/agents/nodes/04c_streetView.ts`,
`tests/integration/04b-idempotency.test.ts`.

**What:**
1. **04a:** GPT-5 vision over subject listing photos. Skip if `listing` null.
   Output schema uses the **frozen enums** from CLAUDE.md §7.4
   (`[R42]`): `condition: 'excellent' | 'good' | 'fair' | 'poor' |
   'unliveable'`; `staging` enum; `presentationFactors[]` and
   `redFlags[]` capped at 6 × ≤80 chars.
2. **04b:** `p-limit(6)` fan-out over 30 comps.
   - **At node entry:** `loadArtifacts(reportId, 'visionComps')` →
     hydrate `state.comparables[i].visionAnalysis` from the map for any
     compId present.
   - **For each comp not present:** call vision. On success,
     `saveArtifact(reportId, 'visionComps', compId, result, costUsd)`
     **before** returning, then merge into `state.comparables` via the
     merge-by-key reducer (so the per-comp record survives a mid-node
     crash). Per-comp failure logs warn but doesn't abort the node.
   - **No reliance on LangGraph's super-step checkpoint inside the
     node** — the artifact table is the source of truth for resumption.
     `[R21]`
3. **04c:** Pull 4-heading Street View images via B5 → stitch into a 2×2 →
   single GPT-5 vision call → `streetCharacter`, `busyRoad`, `treeCover`,
   `neighbouringConcerns[]`.

**Acceptance:**
- Unit test (mocked LLM, **real** Postgres in Docker): kill the call
  after comp 17 of 30; re-invoke the node with `state.comparables` reset
  to the original 30 (i.e. simulate what happens after a fresh
  `loadArtifacts` rehydrate); exactly **13** new vision calls fire, and
  `state.comparables[*].visionAnalysis` is populated for all 30. Asserts
  that the artifact table — not in-memory state — is the source of
  truth.
- 04a outputs validate against the Zod schema.

**Refinements:** `[R1]` (per-item idempotency), `[R20]` (merge-by-key
preserves prior items), `[R21]` (artifact-table durability).

## C4. Nodes 05, 08, 09

**Files:** `src/agents/nodes/05_planningAndNews.ts`,
`src/agents/nodes/08_fetchRentals.ts`,
`src/agents/nodes/09_fetchRisks.ts`.

**What:**
1. **05 planningAndNews:** call NSW Planning Portal; if LGA is in the
   supplementary set, hydrate from the council feed. Otherwise tag
   `coverage: 'metadata-only'`. GPT-5-mini classifies each DA's relevance.
2. **08 fetchRentals:** `getRentalEstimate` + `searchListingsRent` within
   1 km. Compute `indicativeWeeklyRent` and `grossYieldPct`.
3. **09 fetchRisks:** flood / bushfire / heritage / noise in parallel.
   - **At node entry:** `loadArtifacts(reportId, 'risks')` → seed
     `state.risks` with hydrated categories.
   - **For each missing category:** fetch + classify, then
     `saveArtifact(reportId, 'risks', category, riskFlag, costUsd)`
     before merging into `state.risks` via the merge-by-key reducer.
     `[R21]`

**Acceptance:**
- Mosman address → 05 returns `coverage: 'metadata-only'` (Mosman has no
  supplementary feed); composed prose will reflect this in Phase D.
- Killing 09 after flood+bushfire complete and re-running → heritage+noise
  fire; flood+bushfire don't re-fire (artifact rows present). Verify by
  asserting `report_node_artifacts` row count + `state.risks` length =
  4 after the second run.

**Refinements:** `[R1]` (per-category idempotency), `[R10]` (degraded mode),
`[R12]` (flood WFS), `[R21]` (artifact-table durability).

## C5. Node 06 — `reasonAndSelect` (keystone)

**Files:** `src/agents/nodes/06_reasonAndSelect.ts`,
`src/prompts/reasonAndSelect.ts`,
`src/schemas/reasonSelectOutput.ts`,
`tests/fixtures/reasonSelect/30-comps-sample.json`.

**What:**
1. Build the prompt with the rules from CLAUDE.md §7.8. Plain Australian
   English. Inputs: 30 enriched candidates.
2. GPT-5 with `reasoning_effort: 'high'`. Output schema: `ReasonSelectOutput`
   from Appendix B.
3. Merge decisions back into `state.comparables[i]`.
4. **Regression suite:** a fixed-fixture comp set lives in
   `tests/fixtures/reasonSelect/`. The test asserts:
   - 4–5 selected as `'fair-value'`
   - 2–3 as `'negotiation-anchor'`
   - No comp has `|adjustments.sum| > 15%` selected without an explanation
     longer than 60 chars
   - All `rationale` strings are ≥ 20 chars

**Acceptance:** the keystone test passes deterministically (use seeded prompts
+ snapshot the LLM's choices via a recorded transcript).

## C6. Node 07 — `triangulate`

**Files:** `src/agents/nodes/07_triangulate.ts`,
`src/prompts/triangulate.ts`.

**What:**
- Compose three values: `domainAvm` (subject's `priceEstimate`),
  `compDerived` (weighted mean over selected comps by `similarityScore`),
  `rentalImplied` (`indicativeWeeklyRent * 52 / typicalSuburbYield`).
- GPT-5 standard reasoning picks weights and writes a narrative.
- **Re-normalise weights** if `rentalImplied` is null (skip case from §7.17).
- **Confidence propagation** (`[R43]`) — pass Domain AVM's
  `confidence` ordinal as a prior into the prompt; record it in the
  output schema.
- **Divergence guardrail** (`[R44]`) — compute `spread = (max - min) /
  median`; if `> 0.25`, prompt is required to set `confidence='low'`
  and produce a non-null `uncertaintyNote`. The Zod refine on
  `TriangulatedValueSchema` enforces this.

**Acceptance:** unit tests —
- Weights always sum to 1.0; null `rentalImplied` re-normalises across
  the remaining two channels.
- Fixture with `domainAvm=1.2M`, `compDerived=950k`, `rentalImplied=1.05M`
  → `spread ≈ 0.24` → no uncertaintyNote required.
- Fixture with `domainAvm=1.5M`, `compDerived=900k`, `rentalImplied=null`
  → `spread = 0.5` → schema rejects unless `confidence='low'` AND
  `uncertaintyNote` populated.

## C7. Nodes 10–12 — compose / critic / revise

**Files:** `src/agents/nodes/10_compose.ts`,
`src/agents/nodes/11_critic.ts`, `src/agents/nodes/12_revise.ts`,
`src/prompts/compose/*.ts` (one per section),
`src/prompts/critic.ts`,
`src/agents/claimDiff.ts`.

**What:**
1. **10 compose:** **9 parallel** GPT-5 standard calls, one per `SectionId`
   (`summary | subject | valuation | comparables | rentals | market | risks |
   planning | negotiation`). Each call sees only its slice of state. Output:
   `ClaimBlock[]` with every `claim`/`range` block carrying a populated
   `sourceRef.path` (`[R22]`) — voice rules from §7.12.
   - **At node entry:** `loadArtifacts(reportId, 'compose')` →
     hydrate `state.prose` from any rows with `revisionRound = 0`.
   - **Per section completed:** `saveArtifact(reportId, 'compose',
     sectionId, blocks, costUsd, revisionRound=0)` before merging into
     `state.prose`. `[R21]`
2. **11 critic Pass 1 (deterministic):** `claimDiff.ts` walks each
   `ClaimBlock` of type `claim` / `range`. For each, `resolvePointer(state,
   block.sourceRef.path)` to obtain the canonical value and compare with
   the tolerance from §7.13. Mismatch → blocker. `PointerUnresolvedError`
   → blocker tagged `unresolved-source`. `[R22]`
3. **11 critic Pass 2 (LLM):** GPT-5 standard, full prose + state slices.
   Severity contract spelled out in the system prompt.
4. **12 revise:**
   - **Counter durability:** in a single transaction, increment
     `state.reviseIterations` to `n+1` *and* insert
     `report_node_artifacts(reportId, 'revise', 'iter-{n+1}',
     {findings: [...]}, 0, n+1)`. This makes the iteration count
     durable across Inngest step retries — a crashed iteration still
     counts, eliminating infinite-loop paths. `[R29]`
   - For each finding, regenerate only the affected `section` and
     `saveArtifact(reportId, 'compose', sectionId, blocks, costUsd,
     revisionRound=n+1)` before merging into `state.prose`.
   - Hard cap on `MAX_REVISIONS = 2`.

**Acceptance:**
- Inject a wrong number into a `ClaimBlock` and run Pass 1 → blocker
  emitted with the offending `sourceRef.path`.
- A `ClaimBlock` whose `sourceRef.path` doesn't resolve in `state` →
  blocker tagged `unresolved-source` (not a silent pass).
- Revise loop terminates after 2 iterations regardless of remaining
  findings. Additional regression: crash mid-iteration-1 → on retry the
  counter is already at 1 and only iteration-2 has budget remaining.

**Refinements:** `[R1]` (per-section idempotency), `[R4]` (ClaimBlocks +
deterministic critic), `[R21]` (artifact-table durability for compose +
revise), `[R22]` (`resolvePointer` in critic Pass 1), `[R29]`
(`reviseIterations` durability).

## C8. Graph wiring + cost-ceiling guard

**Files:** `src/agents/graph.ts`, `src/agents/guards/costCeiling.ts`,
`src/agents/guards/domainQuota.ts`.

**What:**
1. Wire the graph exactly as CLAUDE.md §6.2. Use `addEdge([...], target)` for
   joins. Conditional edge from `critic` via `shouldRevise`.
2. **Cost-ceiling guard:** wrap each node entry with a worst-case-aware
   check:
   ```ts
   const ctx = reportCtx.getStore()!;
   if (ctx.costUsd + WORST_CASE_NODE_COST[nodeName] > 10) {
     throw new CostCeilingError();
   }
   ```
   `WORST_CASE_NODE_COST` is exported from `src/tools/llm/costs.ts`
   (B6). Without the lookahead, a 9-parallel compose entering at $9.50
   lands at $11+ before the next boundary fires. Fires **between**
   nodes, never mid-call. `[R2]`, `[R23]`.
3. **Inngest step entry cost rehydrate:** the `graphSlice(reportId,
   sliceId)` helper calls `rehydrateCostUsd(reportId)` (B6.4) into
   `reportCtx.getStore()!.costUsd` *before* invoking the graph. Without
   this, a step retry would see `costUsd = 0` and the ceiling would be
   useless. `[R24]`
4. **Domain quota guard** is enforced inside `domainCall` already (B1) —
   no additional code, but unit-test that the cost guard runs *first* at
   a node boundary even when a Domain quota error would also fire.

**Acceptance:**
- Force `costUsd = 9.50` before entering Node 10 (compose) → entry
  throws `CostCeilingError` (worst-case compose is $0.90 + revise
  $1.40 = $2.30 lookahead from the static table).
- Force `costUsd = 9.95` before entering Node 06 → entry throws
  `CostCeilingError` and the report is marked `failed` with
  `errorMessage = 'cost ceiling reached'`.
- Seed three `llm_calls` rows summing to $3.20 for a report; trigger an
  Inngest step retry; assert the first node entry sees `costUsd = 3.20`
  (not 0).

**Refinements:** `[R2]` (between-nodes only), `[R23]`
(`WORST_CASE_NODE_COST` lookahead), `[R24]` (rehydrate from
`llm_calls`).

## C9. **Resumption test** (the hard one — Phase C exit blocker)

**Files:** `tests/integration/resumption.test.ts`.

**What:** simulate a worker crash during Node 04b at comp 17 / 30, then
re-invoke `generateReport` for the same `reportId`. Use the real Postgres
checkpointer **and** the real `report_node_artifacts` table + a
controllable LLM mock that counts calls and writes `llm_calls` rows.

**Acceptance:**
- After resume, the report completes successfully.
- Exactly **30** rows in `report_node_artifacts` with `node='visionComps'`
  for this `reportId`.
- Exactly **30** vision results in `state.comparables[*].visionAnalysis`.
- The mock LLM saw exactly **30** invocations total across the two runs
  (no double-charges).
- The cost rehydrate path is exercised: between the two runs, kill the
  in-memory `reportCtx`; on resume, the ceiling check sees the cost
  accumulated by the 17 pre-crash calls (read from `llm_calls`).
- Total cost stays ≤ $10.

**Refinements:** `[R1]` (the whole point of the resumption contract),
`[R20]` (merge-by-key preserves prior items on the second run's reducer
output), `[R21]` (artifact-table durability), `[R24]` (cost rehydrate
across the crash boundary).

---

### Phase C exit gate
- [ ] Real Sydney address produces a valid `ReportState` end-to-end (still
      as JSON; no PDF yet).
- [ ] The reasonAndSelect regression suite passes deterministically.
- [ ] The resumption test passes — `report_node_artifacts` count matches
      `state` length for every multi-item node after a mid-run crash.
- [ ] Cost-ceiling guard fires at a node boundary (with lookahead) and
      aborts cleanly. `rehydrateCostUsd` exercised across a step retry.
- [ ] Critic Pass 1 emits `unresolved-source` blockers when
      `sourceRef.path` is bogus (regression for `[R22]`).
- [ ] All `risks`, `comparables`, `prose` entries are de-duplicated across
      re-runs via the merge-by-key reducers (`[R20]`).

---

# Phase D — Rendering

**Goal:** the JSON state is rendered into an A4 PDF, uploaded to R2, and
served via a signed URL.

## D1. Templates + print CSS

**Files:** `src/report/template/index.tsx`,
`src/report/template/sections/{Summary,Subject,Valuation,Comparables,
Rentals,Market,Risks,Planning,Negotiation}.tsx`,
`src/report/template/styles.css`,
`src/report/template/footer.html`.

**What:**
1. RSC tree that consumes `ReportState` and emits the full report HTML.
2. Print CSS:
   - A4, `15mm` side margins, `20mm` bottom (footer space).
   - `@page { size: A4 }`; `break-inside: avoid` for cards.
   - Force `tabular-nums` on `.money` and `.metric`.
3. Inter (body) + General Sans (display) — self-host woff2 in `public/fonts/`.
   `[R11]`
4. Footer HTML for Puppeteer: page numbers + inlined "Powered by Domain"
   SVG.
5. `renderClaim(block)` (from B7) is used at render-time to substitute
   typed values into `text`.

**Acceptance:** local render of a fixture state produces an HTML file that
prints cleanly to A4 in Chrome's "Save as PDF" with no overflow.

**Refinements:** `[R11]` (General Sans), `[R4]` (claim rendering at PDF time).

## D2. Charts (Observable Plot SSR SVG)

**Files:** `src/report/charts/PricePosition.tsx`,
`src/report/charts/SuburbMedian5y.tsx`,
`src/report/charts/DomHistogram.tsx`.

**What:** three SSR SVG charts inlined into the page. Use
`@observablehq/plot` (the real package name — `[R27]`, corrected from
the original `@plot/plot` typo) with `document` from `linkedom`
server-side. Keep stroke width / font sizes consistent with the rest of
the report.

**Acceptance:** snapshot tests on the SVG output for fixture data.

## D3. Static map

**Files:** `src/report/map.tsx`, `src/tools/mapbox/staticMap.ts`.

**What:** Mapbox Static Images API. Subject marker + comp markers at adjusted
labels. Single image, no interactivity.

**Acceptance:** integration test downloads an image for a fixture location
and asserts a valid PNG byte signature.

## D4. Puppeteer driver + R2 upload + signed URL

**Files:** `src/report/render.ts`, `src/tools/r2/client.ts`,
`src/app/reports/[id]/pdf/route.ts`, `vercel.json`.

**What:**
1. `renderPdf(state) → Buffer` using `@sparticuz/chromium` + `puppeteer-core`.
   Exact `page.pdf` options from CLAUDE.md §13.3.
2. R2 client (S3-compatible): `PutObject` at
   `reports/{reportId}/v{version}.pdf`; `Content-Type: application/pdf`;
   `Cache-Control: private, max-age=0`.
3. `report_versions` row written **before** the `UPDATE reports SET
   status='succeeded'` (so a crash between the two doesn't leave a
   succeeded report with no `report_versions` row).
4. `/reports/[id]/pdf` **streams the PDF through our server** rather
   than redirecting. Authenticate the request, fetch the R2 object
   server-side (using a short-lived signed URL the client never sees),
   and stream bytes back with `Content-Type: application/pdf` +
   `Content-Disposition: attachment`. No browser-visible R2 URL ever
   exists — eliminates leakage via referrer / browser history / shared
   tab capture. Per-download audit entries. `[R47]`
5. **`vercel.json`** — pin the PDF route's function memory to **3008
   MB**. Default 1024 MB OOMs reliably with `@sparticuz/chromium` once
   the page embeds the Observable Plot SVGs and Street View images.
   `[R28]`

**Acceptance:**
- A real run produces a downloadable PDF that opens in Preview / Acrobat.
- "Powered by Domain" + page numbers visible in the footer on every page.
- All fonts embedded (check with `pdffonts`).

---

### Phase D exit gate
- [ ] Full pipeline (Phase C + Phase D) produces a real PDF for a real
      Sydney address in < 5 min.
- [ ] Re-running the same `reportId` creates a v2 row in `report_versions`
      with `supersedesId` set on a new `reports` row, parent marked
      `superseded`.
- [ ] Signed URL works and expires after 7 days.

---

# Phase E — UI polish

**Goal:** the three users can drive the whole pipeline through the UI.

## E1. New Report form

**Files:** `src/app/reports/new/page.tsx`,
`src/components/AddressAutocomplete.tsx`,
`src/components/DedupeDialog.tsx`,
`src/app/api/reports/route.ts`,
`src/app/api/reports/recent/route.ts`.

**What:**
- Address autocomplete backed by Domain Address Suggestions (debounce 250 ms;
  in-flight cancellation).
- **Dedupe lookup (`[R51]`).** As soon as the user picks a suggestion,
  the client fires `GET /api/reports/recent?propertyId=<id>`. The
  route runs the firm-wide query specified in CLAUDE.md §15.1.2 and
  returns `{ id, status, createdAt, userEmail, version } | null`. If
  non-null, render `<DedupeDialog>`:
    - `status='succeeded'` → primary [Open existing] navigates to
      `/reports/{id}`; secondary [Generate new] proceeds with submit.
    - `status='running'` → primary [Wait for that report] navigates
      to `/reports/{id}`; secondary [Generate new anyway] proceeds
      with submit + a `confirm()` warning about parallel Domain
      quota consumption.
- Submit → server action inserts a `reports` row (`status='queued'`,
  `domainPropertyId` from the suggestion) and emits the Inngest event
  `reports/generate.requested`. Redirect to `/reports/[id]`.

**Acceptance:**
- Picking an address from the dropdown + clicking "Generate" lands on
  `/reports/[id]` and shows `status: queued` immediately.
- E2E test: User A submits a property; User B picks the same property
  within 24h → DedupeDialog appears with User A's email + relative
  time. Picking [Open existing] navigates to User A's report. Picking
  [Generate new] proceeds and creates a second `reports` row.
- E2E test: with a `status='running'` row for that propertyId, the
  dialog's primary action routes to the live-progress view.
- Static test: the `/api/reports/recent` query references only top-level
  `reports` columns (regression for the R26 ESLint rule).

**Refinements:** `[R51]`.

## E2. Live progress stepper

**Files:** `src/app/reports/[id]/page.tsx`,
`src/app/api/reports/[id]/route.ts`,
`src/components/ProgressStepper.tsx`.

**What:**
- Poll `/api/reports/[id]` every 2 s while `status='running'`. Response
  shape: `{ status, currentNode, percentage }`.
- 13-step labelled stepper from CLAUDE.md §15.2.

**Acceptance:** during a live run the active step animates and the others
remain neutral; final transition to `succeeded` shows the preview.

## E3. Preview page + versioned regen + share

**Files:** `src/app/reports/[id]/page.tsx` (preview branch),
`src/components/ReportPreview.tsx`, `src/components/RegenButton.tsx`,
`src/app/api/reports/[id]/regen/route.ts`.

**What:**
- Inline PDF preview (`<iframe src=…/pdf>`).
- "Download" → `/reports/[id]/pdf`.
- "Regenerate" → POST to `/api/reports/[id]/regen` → inserts a new `reports`
  row with `version = parent.version + 1`, `supersedesId = parent.id`,
  marks parent `superseded`. (Atomic — in a transaction.) `[R7]`
- "History" affordance lists prior versions; PDFs remain downloadable.

**Acceptance:** regen creates a fresh row, old PDF still downloads, history
shows v1 + v2 with timestamps.

**Refinements:** `[R7]`.

## E4. Email notification

**Files:** `src/inngest/functions/generateReport.ts` (the `email-user` step),
`src/emails/ReportReady.tsx`, `src/emails/ReportFailed.tsx`,
`src/lib/email/resend.ts`.

**What:**
- React-Email templates for "Ready" and "Failed". "Failed" includes
  `emailErrorMessage` (user-friendly version, no stack traces).
- Resend client; from address `reports@<firm-domain>`.

**Acceptance:** end-to-end run delivers an email with a working signed link.

## E5. Dashboard filters + search

**Files:** `src/app/page.tsx`, `src/components/ReportFilters.tsx`.

**What:** filter by status + date range; search by address (ILIKE on
the denormalised top-level `reports.subjectAddress` column populated at
Node 02 fetchSubject success — `[R25]`). The ESLint rule still bans
`state`-JSONB cross-row queries with no allow-list escape; the
denormalised column is the only sanctioned path for address search.

**Acceptance:**
- List updates within 200 ms of filter change for ≤ 1000 rows
  (trigram index on `subjectAddress` makes ILIKE cheap).
- A static-analysis test confirms no production query references
  `state->>'subject.address'` or any other JSONB path on `reports`
  outside an `id`-keyed lookup.

---

### Phase E exit gate
- [ ] Three founding users each run a full report through the UI.
- [ ] Live progress stepper visibly advances through all 13 nodes.
- [ ] Email arrives within 30 s of `status='succeeded'`.
- [ ] Regen produces a v2 and the dashboard shows the history.

---

# Phase F — Hardening (launch gate)

**Goal:** every guardrail in the spec is *actually enforced*; Domain TOS
compliance is signed off in writing; the three users do a first live run.

## F1. Rate limit + cost ceiling enforcement (end-to-end)

**Files:** `src/app/api/reports/route.ts` (entry check),
`src/agents/guards/dailyLimit.ts`.

**What:**
1. Daily limit check at the POST /api/reports entrypoint: read
   `rate_limit_counters(userId, today)`; if ≥ `DAILY_LIMIT (20)`, return 429.
2. **Counter is incremented in the `incr-quota` Inngest step**, which only
   runs on success. `[R6]`
3. Cost ceiling guard from C8 is already enforced — add a Sentry tag
   `cost_ceiling_hit: true` when it fires so we can monitor frequency.

**Acceptance:**
- Burn 20 successful reports → 21st returns 429 with a clean error.
- 20 *failed* reports → no rate limiting (counter untouched).

**Refinements:** `[R2]`, `[R6]`.

## F2. Per-error-class UX

**Files:** `src/components/errors/{ErrorCard, RetrySuggestion}.tsx`,
`src/lib/errors/messages.ts`.

**What:** map each error code → user-facing message:
- `ADDRESS_UNRESOLVED` → "We couldn't find this address…"
- `REGION_UNSUPPORTED` → "Sydney addresses only in Phase 1."
- `DOMAIN_QUOTA_PER_REPORT` → "This address required too many Domain API
  calls. Please report this run id."
- `COST_CEILING` → "This run exceeded its budget. Please report this run id."
- `RATE_LIMIT` → "You've hit your daily limit of 20 reports."
- `PARTIAL_DATA` → never user-facing (logged); the rendered PDF carries the
  degradation note.

**Acceptance:** preview tests for each error type render the right card.

## F3. Audit-log writes

**Files:** `src/lib/audit/write.ts`, call sites in
`src/inngest/functions/generateReport.ts`.

**What:**
1. Zod-schema-validated `auditLogEntry` — fields are **IDs only** (report id,
   user id, node name, status, costs). **No listing fields.** `[R3]`
2. Write at: report-requested, report-succeeded, report-failed, regen, manual
   admin actions on `allowed_emails`.

**Acceptance:** schema validation rejects a write that includes any string
matching a listing-field allow-list (address, agent name, listing id, etc.).

**Refinements:** `[R3]`.

## F4. Domain TOS compliance — wiring

**Files:** `src/app/api/domain-stats/route.ts`,
`src/components/DomainAttribution.tsx`,
`src/report/template/footer.html` (already has the SVG from D1),
`src/lib/links/domainUrl.ts`.

**What:**
1. **Stats callback proxy** at `/api/domain-stats`: receives payloads
   from any user-visible surface (dashboard, preview UI, PDF render),
   batches and forwards to Domain's stats endpoint with `DOMAIN_API_KEY`.
   - **Retry queue** `pending_stats_callbacks(listingId, payload,
     attempts, nextAttemptAt)`. On forward failure, enqueue. Inngest
     cron every 5 minutes drains the queue with exponential backoff
     (cap 24 h, max 12 attempts). `[R37]`
2. **Server-side PDF-time stats** — D4's render step fires a stats
   event for every comp + the subject listing through the same
   `/api/domain-stats` path, even if the user never opens the preview.
   `[R38]`
3. **Per-listing attribution in PDF body** — D1 templates already
   inline a "Source: Domain.com.au" line under each comp card, linked
   via `domainUrl(listing)`. `[R39]`
4. **"Powered by Domain"** SVG: inlined in both PDF footer (D1) and the
   preview UI.
5. `domainUrl(listing)` → canonical Domain URL with the required UTM
   tag (`utm_source=<licenseeId>&utm_medium=referral&utm_campaign=
   propsearch_report`). All UI + PDF references go through this
   helper; CI lint rejects hand-built `domain.com.au` URLs.

**Acceptance:**
- DevTools shows a `/api/domain-stats` POST every time a listing card is
  rendered.
- A real PDF render triggers one stats event per comp + one for the
  subject, all confirmed in Domain's logs.
- Forcing the stats endpoint to 500 → rows accumulate in
  `pending_stats_callbacks`; the next cron run drains them.
- Every listing link in the UI and PDF resolves to `domain.com.au/...` with
  the UTM tag attached.
- Every comp card in the PDF carries a visible "Source: Domain.com.au"
  line (D1 snapshot test).

**Refinements:** `[R3]`, `[R37]` (retry queue), `[R38]` (PDF-time
stats), `[R39]` (per-comp attribution).

## F5. Domain sign-off (launch blocker)

**What:** obtain written confirmation from Domain on:
1. **Snapshot-storage interpretation** — `reports.state` is OK as a
   single-report point-in-time snapshot with `api_reader` restrictions,
   90-day TTL, and the ESLint cross-row-query block.
2. **OpenAI vision transmission** — vision-augmented analysis of
   Domain-hosted media is permitted under our API tier. If denied,
   **switch nodes 04a/04b to text-only fallback before launch.**
3. **Allow-listed internal use vs the "no paywall" rule.** The Domain
   FAQ requires price-estimate and agent-contact data not be behind a
   paywall. Our app is gated by an email allow-list (3 founding
   licensees of the firm). Confirm Domain treats this as "internal
   licensee use", not a consumer-facing paywall. If denied, the
   product cannot launch in its current shape.
4. **UTM tag exact values** — confirm `utm_source`, `utm_medium`,
   `utm_campaign` strings expected from a licensee at our tier.
5. **Stats callback payload schema** — confirm exact field names and
   the events Domain wants emitted (`listing_viewed`, `listing_clicked`
   etc.).

Track this in the launch checklist (PR or issue), do not launch without
all five in writing.

**Refinements:** `[R3]`.

## F6. State purge cron

**Files:** `src/inngest/functions/statePurge.ts`.

**What:** nightly Inngest cron — `UPDATE reports SET state = NULL WHERE
status IN ('succeeded','superseded') AND completedAt < now() - interval '90 days'`.
Also drop matching `report_versions.stateSnapshotKey` blobs from R2.

**Acceptance:** seed a record with `completedAt = 91 days ago`; next cron
clears its `state`. PDF still downloads.

**Refinements:** `[R3]` (retention rule).

## F7. Operational alerts + DR drill

**Files:** `src/inngest/functions/dailyCostSummary.ts`,
`src/inngest/functions/r2BackupSnapshot.ts`,
`src/lib/observability/slack.ts`.

**What:**
1. **Daily cost summary cron** — 09:00 AEST, posts per-user + total
   spend from `llm_calls` to a Slack webhook, flags users > $50/day.
2. **Fallback-rate Sentry alert rule** — `provider='anthropic'` over
   5% in any rolling hour → Slack; over 20% → page.
3. **Cost-ceiling-hit Sentry alert rule** — > 1 hit / 24h → Slack.
4. **R2 weekly backup cron** — `r2BackupSnapshot` mirrors PDFs to a
   second-region R2 bucket. Surfaces failure to Slack.
5. **Restore drill** — once before launch: take a Supabase snapshot,
   restore to a staging project, run `pnpm db:migrate`, log in as one
   founder, open a previous report. Document the steps in
   `docs/runbooks/restore.md`.

**Acceptance:**
- Slack channel receives a cost summary at 09:00 the morning after
  any reports run.
- Manually triggering an Anthropic-only path on a test report bumps the
  fallback counter visibly in Langfuse.
- Restore drill completes inside the documented RTO (≤ 4 h).

**Refinements:** `[R33]` (alerts), `[R36]` (DR posture).

## F8.0 Offboarding + key-rotation runbooks

**Files:** `src/lib/admin/purgeUserData.ts`,
`docs/runbooks/offboarding.md`, `docs/runbooks/key-rotation.md`,
`src/app/api/admin/purge-user/route.ts` (Supabase secret-key auth only — uses `SUPABASE_SECRET_KEY`, the post-2025 replacement for `service_role`).

**What:**
1. Implement `purgeUserData(userId)` per CLAUDE.md §10.1.1 — R2 first,
   then a single transaction over `report_versions /
   report_node_artifacts / llm_calls / rate_limit_counters / reports
   / allowed_emails`, then Supabase Auth delete. `[R50]`
2. Write the rotation runbook from CLAUDE.md §16.0.1 — concrete
   commands for each provider; "smoke test after rotation" checklist.
   `[R48]`

**Acceptance:**
- Integration test: seed a user with 3 reports + R2 PDFs; call
  `purgeUserData`; assert 0 rows + 0 R2 objects remain; `audit_log`
  records the purge with ID-only fields.
- Runbook dry-run on a single test key (e.g. `RESEND_API_KEY`)
  completes without downtime.

**Refinements:** `[R48]`, `[R50]`.

## F8. First live runs

**What:** each of the three users runs:
- One known address (regression-style)
- One brand-new address they'd actually want a report on

For each:
- Capture the Langfuse trace URL
- Capture total cost from `llm_calls`
- Capture latency from `audit_log`
- Walk through the PDF together; record any prose / claim issues for the
  Phase G backlog

**Acceptance:** all 6 runs succeed within the 5-min latency budget and under
the $10 cost ceiling; no Sentry errors.

---

### Phase F exit gate / launch checklist
- [ ] Rate limit + cost ceiling enforced and tested.
- [ ] Per-error-class UX shipped.
- [ ] Audit-log schema test green; no listing fields ever written.
- [ ] Domain stats callback firing; attribution + UTM-tagged links present
      everywhere.
- [ ] **Written Domain sign-off obtained for both snapshot-storage AND
      OpenAI vision transmission.**
- [ ] State purge cron running on schedule.
- [ ] All three users have run + accepted at least 2 reports each.
- [ ] Sentry has zero unresolved errors from the past 24 h of usage.

---

# Cross-cutting concerns (apply throughout)

## Refinement traceability

| `[Rxx]` | Lands in |
|---|---|
| R1 — resumption contract | C3 (04b idempotency), C4 (09 idempotency), C7 (compose idempotency), C8 (graph wiring), C9 (resumption test) |
| R2 — $10 cost ceiling between nodes | C8 (guard), F1 (Sentry tag) |
| R3 — TOS guardrails | A2 (api_reader), A6 (ESLint rule), F3 (audit-log schema), F4 (TOS hooks), F5 (sign-off), F6 (state purge) |
| R4 — structured ClaimBlocks + deterministic critic | C1 (schema), C7 (compose + critic), D1 (claim render) |
| R5 — middleware allow-list + 4 h JWT | A3 |
| R6 — counter on success only | F1 |
| R7 — versioning + report_versions | A2 (table), E3 (regen + history), D4 (write order) |
| R8 — partial-data policy | C4 (per-category null), C6 (re-normalise weights), D1 (degradation notes in PDF) |
| R9 — pinned deps + model IDs in env | A1 (pins), B6 (model IDs), A6 (CI grep) |
| R10 — LGA gate + metadata-only mode | B4, C4 |
| R11 — General Sans | D1 |
| R12 — flood WFS | B4 |
| R13 — no underquoteSignal | C1 |
| R14 — weights sum constraint | B7, C1 |
| R15 — fallback contract | B6 |
| R16 — AsyncLocalStorage | B1 |
| R17 — two PG URLs | A2, C1 (checkpointer) |
| R18 — Google Maps key restriction | B5 |
| R19 — AU residency removed | (no work needed) |
| R20 — merge-by-key reducers | C1 (state + helper), C3 (04b), C4 (09), C7 (compose) |
| R21 — `report_node_artifacts` durability | A2 (table), C1 (helpers), C3, C4, C7, C9 (resumption test) |
| R22 — `SourceRef.path` + `resolvePointer` for critic Pass 1 | C1, C7 |
| R23 — `WORST_CASE_NODE_COST` lookahead on ceiling check | B6, C8 |
| R24 — cost rehydrate from `llm_calls` on Inngest retry | B6, C8, C9 |
| R25 — `subjectAddress` denormalised column | A2 (column + trigram), E5 (search) |
| R26 — `api_reader` as defense-in-depth, lint is primary | A2, A6 |
| R27 — `@observablehq/plot` package-name fix | D2 |
| R28 — PDF route memory 3008 MB on Vercel | D4 |
| R29 — `reviseIterations` checkpointed before regen | C7 |
| R30 — prompt versioning + baseline pin | B6, C5 |
| R31 — NSW VG quantitative drift tripwires | B3 |
| R32 — per-user Inngest concurrency | (lands implicitly via CLAUDE.md §12; no separate task) |
| R33 — operational alerts (cost, fallback, ceiling) | F7 |
| R34 — both-providers-down error class + quota preservation | B6 |
| R35 — email-delivery failure UX | E2/E3 (status chip + resend) |
| R36 — DR posture (PITR, R2 weekly mirror, drill) | F7 |
| R37 — stats callback retry queue | F4 |
| R38 — PDF-time stats fire | F4 |
| R39 — per-comp PDF attribution | D1, F4 |
| R40 — NSW VG vs Domain sale tiebreaker | C2 |
| R41 — NSW VG outlier filter | B3 |
| R42 — vision-output enums frozen | C3 |
| R43 — AVM confidence propagation | C6 |
| R44 — triangulation divergence guardrail | C6 |
| R45 — Inngest webhook signature verification | A5.1 |
| R46 — CSP headers | A5.1 |
| R47 — PDF proxy stream | D4 |
| R48 — API key rotation runbook | F8.0 |
| R49 — Sentry PII scrubbing | A4 (logger redaction extended) |
| R50 — user offboarding deletion path | F8.0 |
| R51 — firm-wide 24h dedupe at New Report | A2 (column + index), E1 (dialog + endpoint) |

## Testing strategy at a glance

- **Unit (Vitest + MSW):** every Domain wrapper, similarity, claim render,
  weight sum, cost estimator.
- **Integration (Vitest + real Postgres in Docker, mocked LLM):** node-pair
  tests (01-03, 04b idempotency, 09 idempotency), end-to-end JSON state.
- **End-to-end (manual, real services, real address):** Phase D exit + Phase
  F7 live runs.
- **Resumption test (C9):** Phase C exit blocker. Real Postgres, real
  checkpointer, controllable LLM mock.

## When something is unclear

1. Read `CLAUDE.md` §X corresponding to the area.
2. If still unclear, read the original `engineering_spec_refined.docx` for
   editorial context.
3. If still unclear, **don't guess on guardrails** (TOS, cost ceiling, rate
   limit, retention) — ask the user.
