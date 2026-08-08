# propsearch on the fungi-family GCP platform

Verified live **2026-08-08**. propsearch runs in the shared `fungi-family` project
(`asia-southeast1`, Singapore). Platform Terraform lives in the **fungi** repo at `infra/`;
propsearch is onboarded by `infra/app-propsearch.tf` calling `infra/modules/app`.

Region note: Singapore is ~30 ms from Hong Kong versus ~130 ms to Sydney, so leaving Supabase's
`ap-southeast-2` is a latency improvement for this operator, not a regression.

## Services

| | URL | Runtime SA | Shape |
|---|---|---|---|
| `propsearch-web` | https://propsearch-web-fzsxkxioqa-as.a.run.app | `propsearch-web@fungi-family.iam.gserviceaccount.com` | 1 vCPU / 1 GiB / 60 s / min 0, max 3 |
| `propsearch-worker` | https://propsearch-worker-fzsxkxioqa-as.a.run.app | `propsearch-worker@fungi-family.iam.gserviceaccount.com` | 2 vCPU / 2 GiB / 900 s / min 0, max 4 |

Both are allow-unauth. The web service authenticates users itself; the worker serves only
`/api/inngest` and is gated by `INNGEST_SIGNING_KEY`, because Inngest cannot send OIDC tokens —
the same posture as fungi's GCIP blocking functions, which are allow-unauth and validate the JWT
in the request body.

**There is no load balancer.** Inngest is pointed directly at the worker URL and users hit the web
URL. A Cloud Load Balancer would cost ~$18/mo and undo a third of the migration's saving.

Two services exist so Chromium (~500 MB) stays out of the web image and the dashboard cold-starts
fast; the worker's slower start is invisible because Inngest calls it asynchronously.

**As of this writing both services run `us-docker.pkg.dev/cloudrun/container/hello`.** Terraform
owns their shape, not their image tag (`lifecycle.ignore_changes` on the image), so CI deploys do
not fight Terraform.

## Database

Database `propsearch` inside the **shared** instance `fungi-family:asia-southeast1:fungi-db`
(`POSTGRES_16`, `db-g1-small`, ZONAL). IAM auth, no passwords. Reached over the Cloud Run Unix
socket at `/cloudsql/fungi-family:asia-southeast1:fungi-db/.s.PGSQL.5432`.

**No extensions.** `gen_random_uuid()` is core Postgres 13+, and `postgis`/`pg_trgm` are never
queried by propsearch code — the old Supabase database carried 7.1 MB of unused PostGIS
`spatial_ref_sys` for nothing.

IAM DB users: `propsearch-web@fungi-family.iam`, `propsearch-worker@fungi-family.iam`,
`propsearch-ci@fungi-family.iam`.

### Connection budget

`max_connections` is pinned at **60** for the whole instance — deliberately below what 1.7 GB
would allow, so exhaustion is a clean `too many clients` error rather than an OOM that takes down
every app. An alert fires at 42 (70%).

propsearch's budget is **14**: web 3 instances × pool 2, plus worker 4 × pool 2. The module
asserts a per-app ceiling of 20 at plan time. Measured fungi usage is 3 connections, so the
instance currently has ample headroom.

### Table-ownership trap

Migrations applied by `propsearch-ci` are **owned by that role and invisible to the runtime
service accounts** until explicitly granted. This is the same trap documented in fungi's
`docs/GCP_RESOURCES.md` §2. The deploy pipeline must run a grant step, not just `db:migrate`.

## Storage

Private bucket `gs://propsearch-reports` — uniform access, public-access-prevention enforced,
versioned. Accessed via ADC on the runtime service accounts, so there are **no storage credentials
in env at all**.

`reports.pdf_url` holds an **object key**, not a URL. Existing rows stay valid across the S3→GCS
move.

## Secrets

`propsearch-*` in Secret Manager, accessor bound **per-service** (the web tier cannot read the
worker's LLM keys).

| Secret | State |
|---|---|
| `propsearch-session-secret` | real (generated 48-byte random) |
| `propsearch-openai-api-key` | real |
| `propsearch-rapidapi-key` | real |
| `propsearch-mapbox-token` | real |
| `propsearch-google-maps-key` | real |
| `propsearch-google-oauth-client-id` | **`PLACEHOLDER_REPLACE_BEFORE_CUTOVER`** |
| `propsearch-google-oauth-client-secret` | **`PLACEHOLDER_REPLACE_BEFORE_CUTOVER`** |
| `propsearch-inngest-event-key` | **`PLACEHOLDER_REPLACE_BEFORE_CUTOVER`** |
| `propsearch-inngest-signing-key` | **`PLACEHOLDER_REPLACE_BEFORE_CUTOVER`** |

Placeholders exist because Cloud Run refuses to start a revision whose `secret_key_ref` targets
`latest` on a versionless secret. They are harmless while the services run the placeholder image,
which reads no env. **All four must be replaced before the app serves real traffic.**

Replace one with:

```bash
printf '%s' '<value>' | gcloud secrets versions add <secret-name> --project fungi-family --data-file=-
```

## CI

Keyless via Workload Identity Federation. Set these as GitHub repository secrets in
`henrywfyeung/propresearch`:

- `WIF_PROVIDER` = `projects/505888948678/locations/global/workloadIdentityPools/github-pool/providers/apps-provider`
- `WIF_SERVICE_ACCOUNT` = `propsearch-ci@fungi-family.iam.gserviceaccount.com`

Images go to the shared registry:
`asia-southeast1-docker.pkg.dev/fungi-family/apps/propsearch-{web,worker}:<sha>`.
Cleanup keeps the last 3 tagged versions per image and deletes untagged after 24 h.

CI holds `run.developer`, `cloudsql.client`, `cloudsql.instanceUser`, `iam.serviceAccountUser`, and
`artifactregistry.writer` **scoped to the `apps` repo**. It deliberately has no project-wide
`storage.admin` (which would let it delete fungi's buckets) and no Cloud Build role — images build
in the Actions runner and push straight to Artifact Registry.

## Monitoring

On the existing `fungi admin email` channel:

- `propsearch-web` / `propsearch-worker` 5xx above 5 in 5 min
- `propsearch-web` / `propsearch-worker` p95 latency above 80% of their own timeout
- `fungi-db` connections above 42
- Platform budget **HKD 480**/month at 50%, 90% forecast, 100%

Currency note: the billing account is denominated in **HKD**. Google's published list prices are
USD; invoices are HKD (~7.8 HKD per USD).

## Onboarding another app

1. Add `infra/app-<name>.tf` calling `./modules/app`. **Root directory, not a subdirectory** —
   Terraform loads `*.tf` from the root module only and does not recurse.
2. Add the repo to `var.app_github_repos` in `infra/variables.tf`.
3. `terraform apply`, then **populate its secrets** — Cloud Run will not start otherwise.
4. Budget its connections against the instance's 60 before raising `max_instances`; the module
   fails the plan if the app claims more than 20.

`app_name` must be 2–19 characters so `<app_name>-worker` fits the 30-char service-account id limit.

## Known follow-ups

- Migrate fungi itself into `modules/app`. Its drift is now imported, so this is unblocked, but it
  is a state-move exercise best done with `moved` blocks.
- Extract platform Terraform into a dedicated `platform` repo. It currently lives in the fungi app
  repo because the GCS state backend is there.
- Model ids in `infra/app-propsearch.tf` (`OPENAI_MODEL_*`) were carried from a developer
  `.env.local` and **must be reconciled against the live Vercel production env at cutover**.
- No LangGraph checkpointer is wired in propsearch, so a crashed report loses all work. Given 5 of
  the first 6 reports failed, resumability may pay for itself in saved LLM spend.
