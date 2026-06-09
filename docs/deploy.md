# Deploying to Vercel (CI/CD)

CD is codified in [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml):
**every push to `main`** runs the test gate (lint + typecheck + tests), then
builds and deploys to **Vercel production** via the Vercel CLI. CI
([`ci.yml`](../.github/workflows/ci.yml)) runs the same gate on every PR.

> The deploy job stays **dormant** (workflow shows green, deploy skipped) until
> the three Vercel secrets below exist — so it never fails before setup is done.

## One-time setup

### 1. Create the Vercel project + read its IDs

```bash
npm i -g vercel
vercel login                 # browser auth
vercel link                  # choose "create new project" (or link an existing one)
cat .vercel/project.json     # → { "orgId": "team_…", "projectId": "prj_…" }
```

(`.vercel/` is git-ignored — don't commit it.) Alternatively, create the project
in the Vercel dashboard and copy **Project ID** from Project → Settings → General,
and the **Team/Org ID** from the team's settings.

### 2. Create a Vercel access token

Vercel → **Account Settings → Tokens → Create Token** (scope it to the account/team
that owns the project).

### 3. Add the three GitHub secrets

```bash
gh secret set VERCEL_TOKEN                      # paste the token at the hidden prompt
gh secret set VERCEL_ORG_ID --body "team_…"
gh secret set VERCEL_PROJECT_ID --body "prj_…"
```

The next push to `main` (or **Actions → Deploy (production) → Run workflow**) will
now deploy automatically.

### 4. Set the runtime env vars in Vercel (once)

Vercel → Project → **Settings → Environment Variables** (Production scope). Bulk-paste
these from `.env.local` — the Vercel UI accepts a pasted `.env` block:

```
DATABASE_URL, WORKER_DATABASE_URL,
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
OPENAI_API_KEY, OPENAI_MODEL_REASONING, OPENAI_MODEL_COMPOSE, OPENAI_MODEL_VISION,
RAPIDAPI_KEY, RAPIDAPI_REA_HOST, MAPBOX_TOKEN, GOOGLE_MAPS_KEY,
S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_REGION
```

**Do not add** `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` — the Inngest Vercel
integration writes those itself (install it separately: Inngest dashboard →
Apps → Sync new app → Connect Vercel). Skip the CLI-only vars
(`BEDS`/`PARKING`/`PHOTOS`/`SAVE_REPORT_PNG`/`CHROME_PATH`) and the tuning knobs
(`REASON_*`, `VISION_COMPS_TOPK`) — their defaults already match production.
Optional: `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL_FALLBACK` for LLM fallback.

### 5. Set the plan to Pro

Required for the **300 s function timeout** the report render + LangGraph pipeline
needs (Hobby caps at 60 s and reports would time out).

## After setup — the no-click loop

```
git push main → GitHub Actions: lint + typecheck + tests → vercel build → vercel deploy --prod
```

Watch it in the repo's **Actions** tab; the production URL is shown on the
`deploy` job (and recorded under the `production` environment). Manual redeploy:
**Actions → Deploy (production) → Run workflow**.

## Secrets reference

| Secret | Where from | Used by |
|---|---|---|
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens | `vercel pull/build/deploy` |
| `VERCEL_ORG_ID` | `.vercel/project.json` (`orgId`) | Vercel CLI project resolution |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` (`projectId`) | Vercel CLI project resolution |
