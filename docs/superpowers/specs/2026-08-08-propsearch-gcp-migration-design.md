# Migrate propsearch to GCP; make `fungi-family` a multi-app platform

**Date:** 2026-08-08
**Status:** approved, ready for implementation planning
**Goal:** eliminate $20/mo Vercel Pro + $25/mo Supabase Pro by moving propsearch onto the
existing `fungi-family` GCP project, and restructure that project so adding app #3 is cheap.

---

## 1. Why

propsearch pays **$45.05/mo** for a deployment that is far smaller than `CLAUDE.md` implies.
Measured live on 2026-08-08:

- Supabase Postgres is **19 MB**, of which **7.1 MB is PostGIS's `spatial_ref_sys`** — a table
  nothing queries. Real application data is **~700 KB**.
- Contents: 1 user, 2 allow-listed emails, 6 reports (1 succeeded, 5 failed), 715 `llm_calls`.
- 5 of 10 tables are empty and referenced nowhere in code.
- **Vercel Pro buys exactly one thing**: `maxDuration = 300` on `/api/inngest`
  (`src/app/api/inngest/route.ts:18`). Hobby caps at 60 s and reports time out.

Meanwhile `fungi-family` already runs an always-on Cloud SQL instance (`fungi-db`,
`db-g1-small`, ZONAL) costing **$35.77/mo** at **1% utilisation** — 110 MB of data, 4
requests/day, peak 3 connections, 11.5% CPU, 43% memory.

Cloud Run's request timeout is **60 minutes**, so the constraint Vercel Pro exists to relieve
disappears. propsearch's database fits inside an instance already being paid for. That is the
whole opportunity.

### Things that are *not* costing money today

Confirmed by inspection, contrary to `CLAUDE.md` §2.4:

- **Sentry** — `SENTRY_DSN` is empty; the build plugin and all three configs are dormant.
- **Langfuse** — `langfuse` / `langfuse-langchain` are dependencies that are never imported.
- **Resend / react-email** — never imported. No email is sent anywhere.
- **Inngest** — free Hobby tier (50k steps/mo).

So the migration targets exactly two line items: Vercel and Supabase.

---

## 2. Decisions taken

| # | Decision | Rationale |
|---|---|---|
| 1 | **Share the existing `fungi-db` Cloud SQL instance**; propsearch gets its own database | Marginal DB cost ≈ $0 on an instance at 1% utilisation. Permanently retires the `db-f1-micro` downgrade — 0.6 GB cannot host a platform. |
| 2 | **Plain Google OAuth + HMAC-signed session cookie**, not Firebase Identity Platform | A Firebase project *is* a GCP project, so Firebase Auth would share one user pool with fungi, whose **fail-closed** blocking functions reject any email absent from `core.allowed_emails`. Plain OAuth sidesteps that entirely and leaves fungi's working auth path untouched. |
| 3 | **Keep Inngest** (free), repointed at Cloud Run | Zero migration work; smaller blast radius. Cloud Tasks remains a clean later swap if consolidation is ever wanted. |
| 4 | **Delete dead weight during the move** | Every item sits in a file the migration already touches. |
| 5 | **Two Cloud Run services (web + worker), two images** | Keeps the dashboard's cold start fast by keeping Chromium out of the web image. |
| 6 | **`fungi-family` becomes a multi-app platform** with a reusable Terraform module | More apps are coming; onboarding should be ~25 lines, not a bespoke build-out. |

---

## 3. Platform architecture

### 3.1 Topology: one project, N apps

Isolation comes from naming + IAM + a database and bucket per app, **not** separate projects.
Separate projects would break the shared-Cloud-SQL economics that make this ~$1/mo. The project
ID `fungi-family` cannot be renamed; the display name can, and nothing else need carry the fungi
name. If an app later needs hard isolation, Cloud SQL supports cross-project connections via the
connector — this is not a one-way door.

**Region: `asia-southeast1` (Singapore)** for everything. Required for the Unix-socket path to
`fungi-db`, and correct for the operator, who is Hong Kong–based (billing account "Hong Kong",
fungi's scheduler runs `Asia/Hong_Kong`): ~30 ms to Singapore versus ~130 ms to Sydney. Leaving
Supabase's `ap-southeast-2` is a latency improvement, not a regression.

### 3.2 The platform contract

Every app onboarded to the platform gets, by convention:

| Concern | Convention |
|---|---|
| Compute | `<app>-web`, `<app>-worker` Cloud Run services, min-instances 0 |
| Identity | `<app>-web@`, `<app>-worker@`, `<app>-ci@` service accounts |
| Database | database `<app>` in shared `fungi-db`; one IAM DB user per runtime SA |
| Storage | bucket `<app>-<purpose>`, uniform access, public-access-prevention on |
| Secrets | `<app>-<name>` in Secret Manager; accessor bound **per-SA**, never per-project |
| Images | one **shared** Artifact Registry repo `apps`, images `apps/<app>-<service>:<sha>` |
| CI | shared WIF pool; one `apps-provider` with an explicit repo allow-list condition (`assertion.repository in ["henrywfyeung/propresearch", …]`) — extended by one line per new app. fungi's existing single-repo provider is left untouched. |
| Observability | module-emitted 5xx + latency alert policies on the existing email channel |

A shared `apps` registry rather than per-app repos gives one cleanup policy and one quota story
instead of N.

### 3.3 Terraform: module now, fungi migration later

```
infra/
  modules/app/           # SAs, Cloud Run ×2, SQL database + users, bucket,
                         # secrets + bindings, AR access, WIF binding, alerts
  apps/propsearch.tf     # ~25 lines calling the module
  apps/fungi.tf          # deliberate follow-up — NOT part of this migration
```

fungi's current Terraform is flat and single-app (`google_sql_database "fungi"`,
`google_service_account "web_run"`, `google_cloud_run_v2_service "fungi_web"`) with no modules.

**fungi is deliberately not refactored in this work.** Its own drift note records that the
receipts bucket, the `fungi-recurring` scheduler, and the monitoring channel/policies were
created live and are **not in Terraform state**. Refactoring a module boundary on top of drifted
state is how a plan proposes destroying a working app's resources. Correct order is:
`terraform import` the drift → *then* migrate fungi into the module with `moved` blocks.

**Phase 0 acceptance test: `terraform plan` shows additions only, and zero changes to any
existing fungi resource.**

### 3.4 The shared instance is the platform bottleneck

`max_connections` is currently a tier-derived default — undocumented, and liable to change if
the instance is resized. For a multi-app platform it must be pinned.

- Set **`max_connections = 60`** as an explicit database flag. This is deliberately *below* what
  1.7 GB of RAM would permit. Measured baseline is 43% memory at 3 connections (~730 MB), leaving
  ~970 MB; at roughly 5–10 MB per backend that would allow ~80–100, but a hard 60 means
  connection exhaustion surfaces as a clean `too many clients` error rather than an OOM that
  takes down every app on the instance. 60 accommodates fungi (3) + propsearch (16) + two more
  apps at 14 each = 47, with headroom before a tier bump is needed.
- **Per-app connection budget = Σ(Cloud Run `max_instances` × postgres.js `max`).**
  propsearch spends 3×2 (web) + 4×2 (worker) = **14**, plus 2 for CI migrations = **16**.
- Alert when `num_backends` exceeds 70% of `max_connections` (i.e. 42).
- Scale the tier when that trips, or when memory utilisation is sustained above 75%.
  A tier change is a brief restart.
- Enable **deletion protection** on `fungi-db` (currently off) and cap
  `storageAutoResizeLimit` (currently 0 = unlimited).

`cloudsql.iam_authentication` is already `on`, so IAM auth needs no flag change.

---

## 4. propsearch service shape

| | `propsearch-web` | `propsearch-worker` |
|---|---|---|
| Image target | `web` — no Chromium, ~200 MB | `worker` — +Chromium, ~700 MB |
| CPU / memory | 1 vCPU / 1 GiB | 2 vCPU / 2 GiB |
| Request timeout | 60 s | 900 s |
| Scaling | min 0, max 3 | min 0, max 4 |
| Ingress auth | allow-unauth (app does its own) | allow-unauth + Inngest signature |
| Serves | pages, `/api/reports`, `/auth/*`, `/reports/[id]/pdf` | `/api/inngest` only |

**No load balancer.** Inngest is configured with the worker's `*.run.app` URL directly; users
hit the web service's URL. A Cloud Load Balancer would cost ~$18/mo and undo a third of the
saving. Two independent URLs, zero routing infrastructure.

The worker being allow-unauth while validating a signed request body is the same pattern fungi
already runs for its two GCIP blocking functions. Inngest cannot send OIDC tokens, so
`INNGEST_SIGNING_KEY` remains the gate.

**Database connection.** Cloud Run mounts the socket via `--add-cloudsql-instances`;
`postgres.js` connects over `/cloudsql/<conn>/.s.PGSQL.5432` with IAM auth, using its
`password: () => Promise<string>` hook to supply a fresh access token. No DB password to store
or rotate. Documented fallback if that fights: a password user in Secret Manager.

**fungi's table-ownership trap applies.** Migrations run by `propsearch-ci` are owned by that
role and invisible to the runtime SAs until granted. The deploy pipeline needs an explicit grant
step, not just `db:migrate`.

---

## 5. Code changes

### 5.1 Auth (largest rewrite)

| Action | Files |
|---|---|
| Delete | `src/lib/auth/browser.ts`, `src/lib/auth/middleware.ts`, `src/lib/auth/server.ts` |
| Add | `src/lib/auth/session.ts`, `src/lib/auth/google-oauth.ts`, `src/app/auth/login/route.ts` |
| Rewrite | `src/app/auth/callback/route.ts`, `src/app/auth/signout/route.ts`, `middleware.ts`, `src/lib/auth/user.ts`, `src/app/login/login-button.tsx` |
| Unchanged | `src/lib/auth/allowlist.ts` — Postgres check and 60 s cache stay as-is |

Server-side authorization-code flow. Security requirements, since this is hand-rolled:

- `state` in a short-lived signed cookie (CSRF); `nonce` bound into the ID token.
- On verify, assert `aud` == our client ID, `iss` is Google, and `email_verified` is true.
- `google-auth-library` performs ID-token verification. Do not hand-parse JWTs.
- Session cookie: HMAC-SHA256 over `{userId, email, exp}`; httpOnly, secure, sameSite=lax,
  path=/, 7-day expiry, constant-time comparison. Secret from `propsearch-session-secret`.

`requireAllowedUser()` keeps its cached DB re-check — now a deliberate performance choice rather
than an Edge-runtime workaround. Middleware gets **faster**: local HMAC verification replaces a
per-request HTTPS call to Supabase Auth (`src/lib/auth/middleware.ts:44`).

**No `NEXT_PUBLIC_` variable is needed for auth**, because the login button links to
`/auth/login` server-side. This removes the build-arg problem that
`.github/workflows/deploy.yml:82-87` works around.

### 5.2 Database client collapse

`src/db/client.ts` and `src/db/client-worker.ts` merge into one client. `prepare: false`,
`fetch_types: false`, and `max: 1` are deleted — they exist only to appease Supavisor's
transaction mode, which is gone. Prepared statements on, `max: 2`. The lazy `Proxy` pattern stays
so `next build` works without env vars.

Env follows fungi's convention for platform consistency:
`CLOUD_SQL_INSTANCE_CONNECTION_NAME`, `DB_NAME`, `DB_IAM_USER` replace both `DATABASE_URL` and
`WORKER_DATABASE_URL`.

Call sites to update: `src/lib/auth/allowlist.ts`, `src/lib/auth/user.ts`, `src/db/rate-limit.ts`,
`src/db/reports.ts` (both `db` and `workerDb` imports), `src/tools/llm/structuredCall.ts`,
`drizzle.config.js`, `src/db/migrate.ts`, `scripts/add-allowed-email.ts`.

### 5.3 Schema slim-down

Drop the five empty, unreferenced tables: `audit_log`, `nsw_vg_sales`, `report_versions`,
`report_node_artifacts`, `pending_stats_callbacks`. Keep `users`, `allowed_emails`, `reports`,
`llm_calls`, `rate_limit_counters`, and both partial indexes (`reports_dedupe_idx`,
`reports_running_idx`).

**No extensions.** `gen_random_uuid()` is core PostgreSQL 13+, so `uuid-ossp` is unnecessary, and
`postgis` / `pg_trgm` are never queried. Migration `0001_postgis_pg_trgm.sql` is dropped whole.

Because the target is a fresh database carrying ~700 KB, regenerate a **single `0000_init.sql`
baseline** rather than replaying two migrations and skipping one. The dropped tables remain in
git history and in `CLAUDE.md` if those features are ever built.

### 5.4 Storage: S3 → GCS

`src/tools/storage/s3.ts` → `src/tools/storage/gcs.ts`, preserving the `getPdf` / `uploadPdf`
signatures so the two call sites (`src/agents/nodes/13_render.ts:122`,
`src/app/reports/[id]/pdf/route.ts:32`) barely move.

Use `@google-cloud/storage` with ADC on the runtime SA. Note that
`src/tools/storage/s3.ts:13-16` currently hardcodes static credentials with `?? ''` fallbacks,
making the ambient credential chain unreachable — so `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` are **deleted**, not migrated.

`reports.pdf_url` stores an **object key**, not a URL, so existing rows stay valid across the
move. Convert the download route from full buffering to streaming while in there.

### 5.5 Chromium (largest deletion)

`src/report/pdf.ts` goes from 86 lines to ~35 — only the `CHROME_PATH` branch survives. Delete
`PACK_URL`, `cachedExecPath`, the dynamic `@sparticuz/chromium-min` import, the
`LD_LIBRARY_PATH` mutation, and the `readdir` diagnostics block. Add `--disable-dev-shm-usage`
alongside the existing `--no-sandbox`, because Cloud Run's `/dev/shm` is small.

The worker Dockerfile installs Debian's `chromium` and sets `CHROME_PATH=/usr/bin/chromium`.

**This retires the `AWS_LAMBDA_JS_RUNTIME=nodejs20.x` requirement** documented in
`docs/deploy.md:62-73`, along with the four production firefights recorded in commits `4a70ba1`,
`24383b3`, `80ec2a5`, `2a5c267`.

### 5.6 Config, build, CI

- `next.config.ts`: add `output: 'standalone'`; remove the dead `images.remotePatterns` block
  (nothing imports `next/image`); drop `@sparticuz/chromium-min` from `serverExternalPackages`
  (keep `puppeteer-core`).
- One `Dockerfile`, multi-stage, targets `web` and `worker` sharing a `builder` stage.
- Delete `maxDuration = 300` from `src/app/api/inngest/route.ts:18`.
- Collapse the three `VERCEL_ENV` reads in the Sentry configs to one `APP_ENV`.
- Replace `.github/workflows/deploy.yml` Vercel steps with: WIF auth → build 2 images → push to
  `apps` → `gcloud run deploy` ×2 → `db:migrate` → grant step. `ci.yml` needs no changes.
- Delete `scripts/push-vercel-env.sh`. Rewrite `docs/deploy.md`.
- **Rewrite `.env.example`**, which currently documents 4 of ~50 variables.

### 5.7 Inngest

No code change to the function. Repoint the Inngest app URL at the worker service and move
`INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` into Secret Manager — the Inngest↔Vercel integration
that auto-provisioned them has no GCP analogue.

### 5.8 Dependencies

**Remove (10):** `@supabase/ssr`, `@supabase/supabase-js`, `@aws-sdk/client-s3`,
`@sparticuz/chromium-min`, `langfuse`, `langfuse-langchain`,
`@langchain/langgraph-checkpoint-postgres`, `resend`, `react-email`, `@react-email/components`

**Add (2):** `google-auth-library`, `@google-cloud/storage`

---

## 6. Error handling and testing

**Existing coverage.** 71 unit test files under `tests/unit/` must stay green; most touch none of
this.

**New unit tests.**
- Session cookie: valid round-trip, tampered payload rejected, expired cookie rejected,
  signature-mismatch rejected.
- OAuth: missing/mismatched `state` rejected, `nonce` mismatch rejected, `email_verified: false`
  rejected, non-allow-listed email rejected.

**Integration.** DB connectivity over the Cloud SQL socket; GCS upload/download round-trip.

**The one risk unit tests cannot cover** is PDF render inside the worker image — a locally
installed Chrome proves nothing about the container. Verify by building the worker image and
running a real render in it *before* cutover.

**Failure modes to preserve.** Report generation already degrades gracefully per node; the
compose node tolerates single-section failure. Inngest keeps `retries: 1`. Note there is **no
LangGraph checkpointer** wired today (`.compile()` takes no args), so a crash mid-run loses all
work — unchanged by this migration, but relevant because 5 of 6 reports to date failed.
Resumability is a candidate follow-up with real LLM-spend savings.

---

## 7. Cutover plan

| Phase | Work | Reversible |
|---|---|---|
| 0 | Platform groundwork: TF module, shared `apps` AR repo + keep-last-3 policy, `apps-provider` WIF, pin `max_connections`, deletion protection, storage-autoresize cap, budget alert. **`plan` shows additions only.** | n/a |
| 1 | Provision propsearch infra via module; create OAuth client (console-only — consent screen is not Terraformable); populate secrets | yes |
| 2 | Code migration on a branch: DB client → schema baseline → storage → auth → Chromium/Docker → config | yes |
| 3 | Deploy; run migrations + grants; **generate one real report end-to-end on Cloud Run** | yes |
| 4 | Data migration: `pg_dump` the 5 retained tables; copy 1 PDF S3→GCS | yes |
| 5 | Cutover: repoint Inngest at worker; finalise OAuth redirect URI | yes |
| 6 | Decommission Vercel, Supabase, AWS S3 — only after banking a 30-day Supabase snapshot | **no** |

**Phase 3 is the gate.** One end-to-end report exercises auth, the socket DB path, Inngest→worker
delivery, all 16 graph nodes, Chromium in-container, GCS upload, and the download stream. It
costs $2–3 of LLM spend; pay it deliberately.

**Rollback** through Phase 5 is repointing Inngest, because Vercel and Supabase stay running and
untouched. Only Phase 6 is irreversible, and it is last and manual.

**Data migration luck:** `users.id` is a UUID and auth identity is keyed by **email**, so
preserving the row means plain-OAuth login lands on the same user with foreign keys intact. No
identity remapping.

---

## 8. Cost analysis

### Today — $83.30/mo across both apps

| | $/mo |
|---|---|
| Vercel Pro (buys only `maxDuration=300`) | 20.00 |
| Supabase Pro (19 MB DB + OAuth for 1 user) | 25.00 |
| AWS S3 (1 PDF) | ~0.05 |
| Inngest / Sentry / Langfuse | 0.00 |
| **propsearch subtotal** | **45.05** |
| fungi (Cloud SQL 35.77 + storage 2.38 + backups 0.10) | 38.25 |
| **Total** | **83.30** |

### After — ~$38.80/mo across both apps

| | $/mo |
|---|---|
| Cloud SQL instance (shared by both apps) | 35.77 |
| Cloud SQL storage (10 GB provisioned; propsearch adds ~1 MB) | 2.38 |
| Cloud SQL backups + PITR | ~0.10 |
| Artifact Registry (~3.2 GB total, 0.5 GB free) | ~0.30 |
| Secret Manager (~10 versions, 6 free) | ~0.24 |
| Cloud Run ×4 services, GCS, Cloud Build, egress, logging, monitoring | 0.00 |
| **Total, both apps** | **~38.80** |

Prices are from the Cloud Billing Catalog API for `asia-southeast1` (verified 2026-08-08):
Postgres Zonal Small instance $0.049/hr, Zonal Standard storage $0.238/GiB-mo, backups
$0.112/GiB-mo, Artifact Registry $0.10/GiB-mo, Secret Manager $0.06/version-mo.

**propsearch's marginal cost is ~$0.55/mo.** Cloud Run is free because one report burns ~600
vCPU-s against a 180,000 vCPU-s monthly allowance.

**Saving: ~$44.50/mo ≈ $534/year.** Per-app cost falls from $41.65 to $19.40 and keeps dropping;
app #3 adds ~$0.30–0.60.

### Caveats stated plainly

- **Cloud Run's free tier is per billing account, not per service.** Apps share one pool of
  180k vCPU-s / 360k GiB-s. At propsearch's ~600 vCPU-s per report that is ~300
  report-equivalents/month across *all* apps combined.
- **Artifact Registry is the only line item this migration adds.** fungi already sits at 474.9 MB
  of the 0.5 GB free allowance, so propsearch's images tip it into billing.
- **The real cost is blast radius, not dollars.** One ZONAL Cloud SQL instance with no HA now
  backs every app. A bad migration, runaway query, or zone outage takes down all of them. That is
  what the $534 buys, and it is why Phase 0 pins `max_connections`, sets an explicit per-app
  connection budget, and enables deletion protection.
- Migration also costs engineering time plus a few dollars of LLM spend for end-to-end
  verification runs.

---

## 9. Out of scope

- Migrating fungi into the Terraform module (blocked on importing fungi's live drift first).
- Building the LangGraph Postgres checkpointer / 6-step `graphSlice` split for resumability.
- Email notifications, report versioning, the NSW VG bulk ingest cron.
- Replacing Inngest with Cloud Tasks.
- Custom domain mapping (Cloud Run `*.run.app` URLs are sufficient initially).
- Any change to fungi's auth, blocking functions, or existing resources.
