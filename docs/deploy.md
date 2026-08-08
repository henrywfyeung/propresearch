# Deploying propsearch

propsearch runs on **Google Cloud Run** in the shared `fungi-family` project
(`asia-southeast1`). Infrastructure is Terraform in the **fungi** repo
(`infra/app-propsearch.tf` → `infra/modules/app`); see
[gcp-platform.md](./gcp-platform.md) for the live resource contract.

This replaces the previous Vercel deployment. Vercel Pro existed solely to buy
`maxDuration = 300`; Cloud Run allows 60 minutes, so that constraint is gone
along with the $20/mo.

## Architecture

Two Cloud Run services, two image targets from one `Dockerfile`:

| Service | Serves | Shape |
|---|---|---|
| `propsearch-web` | pages, `/api/reports`, `/auth/*`, `/reports/[id]/pdf` | 1 vCPU / 1 GiB / 60 s / max 3 |
| `propsearch-worker` | `/api/inngest` only | 2 vCPU / 2 GiB / 900 s / max 4 |

They share the `builder` stage so Next.js compiles once. Only the worker
installs Chromium — keeping ~500 MB out of the web image is why the services are
split at all, since the dashboard would otherwise cold-start behind a large pull.

**There is no load balancer.** Inngest is pointed directly at the worker's
`*.run.app` URL; users hit the web URL. A Cloud Load Balancer would cost roughly
$18/mo and undo a third of the migration's saving.

## One-time setup

### GitHub repository secrets

In `henrywfyeung/propresearch` → Settings → Secrets → Actions:

| Secret | Value |
|---|---|
| `WIF_PROVIDER` | `projects/505888948678/locations/global/workloadIdentityPools/github-pool/providers/apps-provider` |
| `WIF_SERVICE_ACCOUNT` | `propsearch-ci@fungi-family.iam.gserviceaccount.com` |

No service-account JSON key exists; authentication is keyless via Workload
Identity Federation.

### Google OAuth client

Console-only — there is no gcloud surface for generic OAuth 2.0 web clients.
In `fungi-family` → APIs & Services → Credentials → Create Credentials → OAuth
client ID:

- Type **Web application**, name `propsearch-web`
- Authorised redirect URIs:
  - `http://localhost:3000/auth/callback`
  - `https://propsearch-web-fzsxkxioqa-as.a.run.app/auth/callback`

This must be a **new** client, not fungi's. Keeping the two apps' identity
surfaces separate is the reason plain OAuth was chosen over Firebase Identity
Platform, whose user pool is per-GCP-project.

Then load the credentials:

```bash
printf '%s' '<CLIENT_ID>' | gcloud secrets versions add propsearch-google-oauth-client-id --project fungi-family --data-file=-
```

### Inngest

Point the Inngest app at the **worker** URL — `https://propsearch-worker-fzsxkxioqa-as.a.run.app/api/inngest` — not the web one. Then load both keys from the Inngest dashboard into `propsearch-inngest-event-key` and `propsearch-inngest-signing-key`.

The Inngest↔Vercel integration used to provision these automatically. There is
no GCP equivalent, so they are manual.

## Deploying

Push to `main`. [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) then:

1. Authenticates via WIF.
2. Builds `web` and `worker` targets, pushes both to
   `asia-southeast1-docker.pkg.dev/fungi-family/apps/`.
3. Starts the Cloud SQL Auth Proxy with `--auto-iam-authn`.
4. Runs `pnpm db:migrate`, then **`pnpm db:grant`**.
5. Deploys both services.
6. Smoke-checks that `/login` returns 200.

Terraform owns each service's *shape* and ignores the image tag, so deploys and
`terraform apply` do not fight each other.

### Why the grant step exists

Cloud SQL tables are owned by whichever role created them. Migrations run as
`propsearch-ci`, so a newly created table is invisible to `propsearch-web` and
`propsearch-worker` until granted — the deploy succeeds and then every query
fails with `permission denied for table`. `scripts/grant-runtime.ts` grants
existing objects and sets `ALTER DEFAULT PRIVILEGES` so future migrations are
covered without editing the script. fungi documents the same trap in its
`docs/GCP_RESOURCES.md` §2.

## Local development

```bash
cp .env.example .env.local   # then fill in the values
pnpm install
pnpm dev
```

Locally the app uses `DATABASE_URL` (a plain connection string) rather than the
Cloud SQL socket, so no GCP access is needed to run or test. Set `CHROME_PATH`
to any Chrome/Chromium binary for PDF rendering.

## Rollback

Cloud Run keeps previous revisions:

```bash
gcloud run services update-traffic propsearch-web --region asia-southeast1 --project fungi-family --to-revisions <REVISION>=100
```

List revisions with `gcloud run revisions list --service propsearch-web --region asia-southeast1`.

Note that a rollback moves *traffic* only — it does not revert a migration, so
schema changes should stay backward-compatible for at least one release.

## Environment variables

Production values come from two places, never a `.env` file:

- **Secret Manager** (`propsearch-*`), mounted per service with accessor bound
  per-service, so the web tier cannot read the worker's LLM keys.
- **Plain env** declared in `infra/app-propsearch.tf` in the fungi repo.

`.env.example` documents the full set for local development.

There are **no build-time secrets**: auth is a server-side OAuth flow, so no
`NEXT_PUBLIC_*` client id needs inlining at build time. That removes the
build-arg juggling the Vercel workflow required.
