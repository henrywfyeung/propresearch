# Platform Groundwork + propsearch Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `fungi-family` into a multi-app GCP platform and provision all propsearch infrastructure, so that plan 2 (code migration) has somewhere to deploy to.

**Architecture:** Reconcile fungi's drifted Terraform state, harden the shared Cloud SQL instance with explicit guardrails, add shared platform resources (one Artifact Registry repo, one multi-repo WIF provider), then build a reusable `modules/app` Terraform module and instantiate it for propsearch. No application code changes in this plan.

**Tech Stack:** Terraform 1.9+, `hashicorp/google` 6.47.0, GCS remote state (`gs://fungi-family-tfstate`, prefix `phase-0`), gcloud SDK at `/usr/local/share/google-cloud-sdk/bin`.

---

## ✅ Execution record — 2026-08-08

**Tasks 1–8 are DONE and applied.** Task 9 is partially done. Task 10 remains.

| Task | Status |
|---|---|
| 1 Baseline drift | done — `10 to add, 1 to change, 0 to destroy` |
| 2 Import drift | done — 10 imported, plan reached `No changes` |
| 3 Harden Cloud SQL | done — `max_connections=60`, autoresize cap 20, API deletion protection, alert at 42 |
| 4 Budget | done — HKD 480 at 50/90/100% |
| 5 `apps` registry | done — with keep-last-3 + delete-untagged |
| 6 `apps-provider` WIF | done — `assertion.repository in ["henrywfyeung/propresearch"]` |
| 7 `modules/app` | done |
| 8 Onboard propsearch | done — 58 resources; both services Ready, HTTP 200 |
| 9 OAuth client + secrets | **secrets done** (5 real/generated, 4 placeholders). **OAuth client still needs manual Console creation — user action.** |
| 10 Handoff doc | pending |

### Seven ways reality differed from this plan

Recorded because each cost real debugging time and each would bite the next app.

1. **The drift was 10 resources, not 5.** fungi's drift note undercounted; five IAM bindings were also live-only. Task 1's expected list is corrected.
2. **Terraform does not recurse into subdirectories.** `infra/apps/propsearch.tf` as originally written would have been **silently ignored**. Per-app files must live in the root module as **`infra/app-<name>.tf`**. Task 8 is corrected below.
3. **Secrets must be populated BEFORE Cloud Run services are created.** Cloud Run refuses to start a revision whose `secret_key_ref` targets `latest` on a versionless secret. The first apply of Task 8 failed on exactly this, so **Task 9 must run before Task 8** (or at least before the services are created).
4. **The billing account is HKD, not USD.** The Budget API rejects a currency mismatch as a bare `Error 400: invalid argument` naming no field. Published Google list prices are USD; invoices are HKD.
5. **billingbudgets rejects local user ADC without a forwarded quota project.** Needs `user_project_override` — added as an aliased `google.billing` provider so no other resource's quota attribution changes.
6. **Two provider-side idempotency traps.** `google_billing_budget.threshold_rules` is an ordered list but the API returns rules grouped by `spend_basis`; and `google_cloud_run_v2_service` has a *service-level* `scaling` block, distinct from `template.scaling`, which the API default-populates. Both produced permanent no-op diffs until declared to match.
7. **`google_iam_workload_identity_pool_provider.display_name` caps at 32 characters.** The first attempt was 35 and failed.

Also: the real `RAPIDAPI_REA_HOST` is **`realty-base-au.p.rapidapi.com`**, not the `realty-in-au...` guessed in Task 8 — which is why that step said to verify it.

---

## ⚠️ Two-repo warning

This plan edits **two repositories**:

- **Tasks 1–9** edit `/Users/henry/Desktop/fungi/infra/` and commit to the **fungi** repo.
- **Task 10** commits documentation to the **propsearch** repo (branch `feat/gcp-migration`).

Every task states its repo explicitly. Do not mix them in one commit.

Platform Terraform stays in the fungi repo for now because the GCS state backend already lives there and moving state is a needless risk. Extracting a dedicated `platform` repo is a documented follow-up, not part of this work.

## Environment setup (do this once per shell)

```bash
export PATH="/usr/local/share/google-cloud-sdk/bin:$PATH"
gcloud config set project fungi-family
```

Confirm you are the right identity — every task below assumes project owner:

```bash
gcloud auth list
```

Expected: `henrywfyeung@gmail.com` marked `*` (ACTIVE).

## Terraform init (do this once)

```bash
cd /Users/henry/Desktop/fungi
terraform -chdir=infra init \
  -backend-config="bucket=fungi-family-tfstate" \
  -backend-config="prefix=phase-0"
```

Expected: `Terraform has been successfully initialized!`

`infra/terraform.tfvars` already exists and supplies `project_id` and `github_repo`. Do not commit changes to it.

---

## Task 1: Baseline the Terraform state (read-only)

**Repo: fungi.** This task changes no files. It exists because fungi's own drift note says the receipts bucket, the `fungi-recurring` scheduler, and the monitoring channel/policies were created live — while `storage.tf`, `scheduler.tf` and `monitoring.tf` all exist in code. `apply` would therefore try to create resources that already exist. We must see the exact list before touching anything.

**Files:** none (read-only)

- [ ] **Step 1: Validate the configuration parses**

```bash
cd /Users/henry/Desktop/fungi
terraform -chdir=infra validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 2: Capture a full plan to a file**

```bash
terraform -chdir=infra plan -no-color -out=/tmp/fungi-baseline.tfplan \
  2>&1 | tee /tmp/fungi-baseline-plan.txt
```

Expected: exit 0 with a summary line like `Plan: N to add, M to change, 0 to destroy.`

- [ ] **Step 3: Assert nothing is scheduled for destruction**

```bash
grep -c "will be destroyed" /tmp/fungi-baseline-plan.txt
```

Expected: `0`

**STOP if this is non-zero.** A destroy against a live app is out of scope for this plan. Report the resource names and halt.

- [ ] **Step 4: List exactly what the plan wants to create**

```bash
grep "will be created" /tmp/fungi-baseline-plan.txt
```

Expected — **measured on 2026-08-08, `Plan: 10 to add, 1 to change, 0 to destroy`**. The drift is
broader than fungi's own drift note claims: it lists 5 resources, but 5 more IAM bindings were
also granted live.

```
google_cloud_run_v2_service_iam_member.blocking_create_invoker
google_cloud_run_v2_service_iam_member.blocking_signin_invoker
google_cloud_scheduler_job.recurring
google_monitoring_alert_policy.sql_disk
google_monitoring_alert_policy.web_5xx
google_monitoring_notification_channel.email
google_project_iam_member.web_run_roles["roles/firebaseauth.admin"]
google_project_iam_member.web_run_roles["roles/firebasecloudmessaging.admin"]
google_storage_bucket.receipts
google_storage_bucket_iam_member.web_receipts
```

- [ ] **Step 4b: Inspect the single in-place change and confirm it is safe**

```bash
awk '/# google_cloud_run_v2_service.fungi_web will be updated/,/^    }$/' \
  /tmp/fungi-baseline-plan.txt | grep -E "^\s*[-+~]|env \{|name|value"
```

Expected: exactly two env changes on `fungi-web` — `RECEIPTS_BUCKET` removed, `NODE_ENV=production`
added. This is drift from fungi's manual gcloud deploy (revision `00014`), which set env vars
Terraform never knew about.

**This was verified safe on 2026-08-08 and requires no action.** `apps/web/lib/storage.ts:7` reads
`process.env.RECEIPTS_BUCKET ?? "fungi-family-receipts"` — the fallback is the identical bucket
name, so dropping the variable resolves to the same bucket.

**If the diff shows anything beyond those two env vars, STOP and report.** Any other change to
`fungi_web` means further manual drift that must be understood before applying, because this plan
must not alter a working app's behaviour.

- [ ] **Step 5: Record the baseline for the next task**

```bash
grep "will be created" /tmp/fungi-baseline-plan.txt \
  | sed 's/.*# //; s/ will be created//' | tee /tmp/fungi-imports.txt
```

Expected: one Terraform address per line. This is the import worklist for Task 2.

There is nothing to commit — this task is pure assessment.

---

## Task 2: Import the drifted resources into state

**Repo: fungi.** Bring the 10 live-created resources under Terraform management so later `apply` runs are safe. Import mutates state only, never infrastructure.

This task uses **Terraform `import` blocks** rather than `terraform import` CLI calls. With 10 resources that matters: the IDs land in a reviewable file, and `terraform plan` shows `will be imported` for each one *before* anything is written to state. A CLI import is 10 unreviewable side effects.

All IDs below were captured live on 2026-08-08 and are exact. Verify they still match in Step 1 rather than trusting them blindly.

**Files:**
- Create (then delete in Step 6): `/Users/henry/Desktop/fungi/infra/imports.tf`
- Modify: `/Users/henry/Desktop/fungi/infra/run.tf` (declare RECEIPTS_BUCKET, Step 2b)

- [ ] **Step 1: Re-verify the live identifiers**

```bash
export PATH="/usr/local/share/google-cloud-sdk/bin:$PATH"
gcloud storage buckets describe gs://fungi-family-receipts --format="value(name)"
gcloud scheduler jobs describe fungi-recurring --location=asia-southeast1 \
  --project fungi-family --format="value(name)"
```

Expected: `gs://fungi-family-receipts` and the scheduler job resource name.

`gcloud alpha`/`beta` are **not installed** in this environment and cannot be added non-interactively, so use the Monitoring REST API for channel and policy IDs:

```bash
TOKEN=$(gcloud auth application-default print-access-token)
for kind in notificationChannels alertPolicies; do
  curl -s -H "Authorization: Bearer $TOKEN" \
    "https://monitoring.googleapis.com/v3/projects/fungi-family/$kind" \
  | python3 -c "
import sys,json
k='$kind'
d=json.load(sys.stdin)
for x in d.get(k[0].lower()+k[1:], d.get(k, [])):
    print(' ', x['name'], '|', x.get('displayName'))
"
done
```

Expected, as measured:

```
  projects/fungi-family/notificationChannels/2579346844929199402 | fungi admin email
  projects/fungi-family/alertPolicies/17395888917638656676 | fungi-web 5xx errors
  projects/fungi-family/alertPolicies/5777355760152144345 | Cloud SQL disk > 85%
```

If any ID differs, use the live value in Step 2.

- [ ] **Step 2: Write the import blocks**

Create `/Users/henry/Desktop/fungi/infra/imports.tf`. This file is temporary and is deleted in Step 6.

```hcl
# TEMPORARY -- delete after `apply` completes the imports (Task 2, Step 6).
#
# These 10 resources were created live (manual gcloud during the phase-0
# session) and exist in code but not in state, so any apply would fail with
# "already exists". fungi's own drift note lists only 5 of them; the 5 IAM
# bindings below were found by `terraform plan` on 2026-08-08.

import {
  to = google_storage_bucket.receipts
  id = "fungi-family-receipts"
}

import {
  to = google_storage_bucket_iam_member.web_receipts
  id = "b/fungi-family-receipts roles/storage.objectAdmin serviceAccount:fungi-web-run@fungi-family.iam.gserviceaccount.com"
}

import {
  to = google_cloud_scheduler_job.recurring
  id = "projects/fungi-family/locations/asia-southeast1/jobs/fungi-recurring"
}

import {
  to = google_monitoring_notification_channel.email
  id = "projects/fungi-family/notificationChannels/2579346844929199402"
}

import {
  to = google_monitoring_alert_policy.web_5xx
  id = "projects/fungi-family/alertPolicies/17395888917638656676"
}

import {
  to = google_monitoring_alert_policy.sql_disk
  id = "projects/fungi-family/alertPolicies/5777355760152144345"
}

import {
  to = google_project_iam_member.web_run_roles["roles/firebaseauth.admin"]
  id = "fungi-family roles/firebaseauth.admin serviceAccount:fungi-web-run@fungi-family.iam.gserviceaccount.com"
}

import {
  to = google_project_iam_member.web_run_roles["roles/firebasecloudmessaging.admin"]
  id = "fungi-family roles/firebasecloudmessaging.admin serviceAccount:fungi-web-run@fungi-family.iam.gserviceaccount.com"
}

# Blocking functions are allow-unauth (GCIP sends no Authorization header), so
# the invoker member is allUsers -- see infra/blocking.tf.
import {
  to = google_cloud_run_v2_service_iam_member.blocking_create_invoker
  id = "projects/fungi-family/locations/asia-southeast1/services/fungi-allowlist-blocker-create roles/run.invoker allUsers"
}

import {
  to = google_cloud_run_v2_service_iam_member.blocking_signin_invoker
  id = "projects/fungi-family/locations/asia-southeast1/services/fungi-allowlist-blocker-signin roles/run.invoker allUsers"
}
```

- [ ] **Step 2b: Declare `RECEIPTS_BUCKET` in Terraform instead of letting it be stripped**

Task 1 Step 4b established that Terraform would remove `RECEIPTS_BUCKET` from the live `fungi-web`
service, and that this is harmless because the code falls back to the same value. Harmless is not
the same as correct: a production bucket name should be declared configuration, not a hardcoded
fallback in `apps/web/lib/storage.ts`.

Add to the `containers` block in `/Users/henry/Desktop/fungi/infra/run.tf`, next to the existing
`NODE_ENV` env entry:

```hcl
      env {
        name  = "RECEIPTS_BUCKET"
        value = google_storage_bucket.receipts.name
      }
```

Referencing the resource rather than a literal means the two can never drift apart. This narrows
the `fungi-web` diff to adding `NODE_ENV=production` — which the live service is currently missing
and should have.

- [ ] **Step 3: Plan and assert 10 imports, 0 creates, 0 destroys**

```bash
cd /Users/henry/Desktop/fungi
terraform -chdir=infra plan -input=false -no-color 2>&1 | tee /tmp/fungi-import-plan.txt
grep -E "^Plan:" /tmp/fungi-import-plan.txt
```

Expected: `Plan: 0 to add, 1 to change, 0 to destroy, 10 to import.`

The remaining change must now be **only** the `NODE_ENV` addition. Confirm:

```bash
awk '/# google_cloud_run_v2_service.fungi_web will be updated/,/^    }$/' \
  /tmp/fungi-import-plan.txt | grep -E "^\s*[-+]"
```

Expected: a single `+ name = "NODE_ENV"` / `+ value = "production"` pair and nothing removed.

```bash
grep -c "will be imported" /tmp/fungi-import-plan.txt   # expect 10
grep -c "will be created"  /tmp/fungi-import-plan.txt   # expect 0
grep -c "will be destroyed" /tmp/fungi-import-plan.txt  # expect 0
```

The `1 to change` is the verified-safe `fungi-web` env drift from Task 1 Step 4b.

**If any resource still shows `will be created`, its import ID is wrong.** Fix the ID; do not apply. Applying a create against an existing resource fails, and worse, a wrong-but-valid ID silently binds state to the wrong object.

- [ ] **Step 4: Apply the imports**

```bash
terraform -chdir=infra apply
```

Expected: `Apply complete! Resources: 10 imported, 0 added, 1 changed, 0 destroyed.`

- [ ] **Step 5: Confirm state is now clean**

```bash
terraform -chdir=infra plan -input=false -no-color 2>&1 | grep -E "^Plan:|No changes"
```

Expected: `No changes. Your infrastructure matches the configuration.`

This is the gate for the whole plan. **Do not start Task 3 until this reports no changes** — every later task asserts "exactly N creates", which is only meaningful from a clean baseline.

- [ ] **Step 6: Delete the temporary import file**

```bash
rm /Users/henry/Desktop/fungi/infra/imports.tf
terraform -chdir=infra plan -input=false -no-color 2>&1 | grep -E "^Plan:|No changes"
```

Expected: still `No changes.` Import blocks are one-shot instructions, not persistent state; removing the file changes nothing.

- [ ] **Step 7: Commit**

Only `imports.tf` was created and it has been deleted, so there may be nothing to commit — import changed remote state, not files. Record the reconciliation anyway so the drift history is legible:

```bash
cd /Users/henry/Desktop/fungi
git checkout -b feat/platform-groundwork
git commit --allow-empty -m "infra: reconcile Terraform state with 10 live-created resources

storage.tf, scheduler.tf and monitoring.tf existed in code while their
resources were created live during the manual phase-0 session, so any apply
failed with 'already exists'. Imported via one-shot import blocks:

  receipts bucket + its objectAdmin binding
  fungi-recurring scheduler job
  monitoring email channel + web_5xx + sql_disk policies
  web_run firebaseauth.admin + firebasecloudmessaging.admin bindings
  both blocking-function allUsers invoker bindings

fungi's drift note listed only the first five; terraform plan found the rest.

Also settles one in-place diff on fungi-web: manual deploy set
RECEIPTS_BUCKET, which Terraform does not declare. Verified harmless --
apps/web/lib/storage.ts:7 falls back to the identical bucket name.

terraform plan now reports no changes, which is the required baseline for
adding platform resources.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
---

## Task 3: Harden the shared Cloud SQL instance

**Repo: fungi.** Add the three guardrails the platform needs before it hosts a second app: API-level deletion protection, a disk-growth ceiling, and a pinned connection limit.

**Files:**
- Modify: `/Users/henry/Desktop/fungi/infra/sql.tf`
- Modify: `/Users/henry/Desktop/fungi/infra/variables.tf`

Note carefully: `sql.tf` already has a **top-level** `deletion_protection = true`. That is Terraform's own destroy guard. The GCP API field is **`settings.deletion_protection_enabled`**, which live inspection showed is `false`. Both are wanted; they are different fields.

- [ ] **Step 1: Add the new variables**

Append to `/Users/henry/Desktop/fungi/infra/variables.tf`:

```hcl
variable "db_max_connections" {
  description = "Pinned Postgres max_connections. Deliberately below what 1.7GB RAM allows so exhaustion surfaces as a clean 'too many clients' error rather than an OOM that takes down every app on the shared instance. Budget: fungi 3 + propsearch 16 + two future apps at 14 = 47."
  type        = string
  default     = "60"
}

variable "db_disk_autoresize_limit" {
  description = "Ceiling in GB for Cloud SQL disk auto-growth. 0 means unlimited, which is an uncapped cost risk on a shared instance."
  type        = number
  default     = 20
}
```

- [ ] **Step 2: Wire them into the instance**

In `/Users/henry/Desktop/fungi/infra/sql.tf`, inside the `settings` block, change:

```hcl
    disk_autoresize   = true
```

to:

```hcl
    disk_autoresize       = true
    disk_autoresize_limit = var.db_disk_autoresize_limit

    # GCP API-level guard. Distinct from the top-level `deletion_protection`
    # above, which only blocks `terraform destroy`.
    deletion_protection_enabled = true
```

Then add a second `database_flags` block immediately after the existing one:

```hcl
    database_flags {
      name  = "max_connections"
      value = var.db_max_connections
    }
```

- [ ] **Step 3: Plan and assert exactly one in-place update**

```bash
cd /Users/henry/Desktop/fungi
terraform -chdir=infra plan -no-color 2>&1 | tee /tmp/sql-harden-plan.txt
grep -E "will be (created|destroyed)" /tmp/sql-harden-plan.txt
```

Expected: **no output** from the grep. Then confirm the intended diff:

```bash
grep -E "deletion_protection_enabled|max_connections|disk_autoresize_limit" /tmp/sql-harden-plan.txt
```

Expected: all three appear as additions (`+`).

- [ ] **Step 4: Apply**

```bash
terraform -chdir=infra apply
```

Expected: `Apply complete! Resources: 0 added, 1 changed, 0 destroyed.`

A `max_connections` change requires a database restart. Cloud SQL performs it automatically; expect the apply to take several minutes and fungi-web to see brief connection errors. This is acceptable at 4 requests/day, but do it outside the 02:00 Asia/Hong_Kong scheduler window.

- [ ] **Step 5: Verify against the live API, not against Terraform**

```bash
gcloud sql instances describe fungi-db --project fungi-family \
  --format="value[separator=' | '](settings.deletionProtectionEnabled,settings.storageAutoResizeLimit,settings.databaseFlags)"
```

Expected: `True | 20 | ` followed by both flags, including `max_connections` = `60`.

- [ ] **Step 6: Add the connection-exhaustion alert**

A pinned limit is only useful if you find out before you hit it. Append to
`/Users/henry/Desktop/fungi/infra/monitoring.tf`:

```hcl
# 70% of the pinned max_connections (60) = 42. This is the platform's
# single most important early-warning signal: connection exhaustion on the
# shared instance degrades every app at once.
resource "google_monitoring_alert_policy" "sql_connections" {
  project      = var.project_id
  display_name = "fungi-db connection count above 70% of max_connections"
  combiner     = "OR"

  conditions {
    display_name = "num_backends > 42 for 5m"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloudsql_database\"",
        "resource.labels.database_id = \"${var.project_id}:${var.db_instance_name}\"",
        "metric.type = \"cloudsql.googleapis.com/database/postgresql/num_backends\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = floor(tonumber(var.db_max_connections) * 0.7)
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
}
```

The threshold is derived from `var.db_max_connections`, so raising the limit moves the alert with it.

- [ ] **Step 7: Plan, assert one create, apply**

```bash
cd /Users/henry/Desktop/fungi
terraform -chdir=infra plan -no-color 2>&1 | grep -E "will be (created|destroyed)"
```

Expected: exactly `# google_monitoring_alert_policy.sql_connections will be created`.

```bash
terraform -chdir=infra apply
```

Expected: `Apply complete! Resources: 1 added, 0 changed, 0 destroyed.`

- [ ] **Step 8: Commit**

```bash
git add infra/sql.tf infra/variables.tf infra/monitoring.tf
git commit -m "infra(sql): pin max_connections=60, cap disk growth, enable API deletion protection

Guardrails required before the instance hosts a second app:
- max_connections pinned at 60, deliberately below what 1.7GB permits, so
  exhaustion is a clean error rather than an OOM affecting every app.
- disk_autoresize_limit=20GB; it was 0 (unlimited), an uncapped cost risk.
- settings.deletion_protection_enabled=true. The pre-existing top-level
  deletion_protection only guards terraform destroy, not the API.
- Alert at 70% of max_connections (42). Connection exhaustion on the shared
  instance degrades every app at once, so this is the platform's most
  important early-warning signal.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Add a billing budget alert

**Repo: fungi.** Nothing currently reports a cost spike. The Budget API is not even enabled.

**Files:**
- Create: `/Users/henry/Desktop/fungi/infra/budget.tf`

- [ ] **Step 1: Enable the API**

```bash
gcloud services enable billingbudgets.googleapis.com --project fungi-family
```

Expected: `Operation "operations/..." finished successfully.`

- [ ] **Step 2: Verify you hold budget permissions on the billing account**

```bash
gcloud billing budgets list --billing-account=019C4F-1AF6A2-161AE4 2>&1 | head -5
```

Expected: an empty list (no budgets yet), **not** a permission error.

If this returns `PERMISSION_DENIED`, you lack `billing.budgets.write` on the billing account. Terraform cannot create the budget. **Fall back to creating it in the Cloud Console** (Billing → Budgets & alerts), then skip to Step 6 and commit only a comment documenting that the budget is console-managed. Do not silently omit the budget.

- [ ] **Step 3: Write the budget resource**

Create `/Users/henry/Desktop/fungi/infra/budget.tf`:

```hcl
# Platform-wide cost guardrail. Measured baseline (2026-08-08) is ~$38/mo for
# fungi + propsearch combined, so $60 leaves headroom for two more apps while
# still catching a runaway well before it matters.

variable "budget_amount_usd" {
  description = "Monthly budget threshold in USD for the whole platform."
  type        = string
  default     = "60"
}

resource "google_billing_budget" "platform" {
  billing_account = var.billing_account
  display_name    = "fungi-family platform monthly budget"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = var.budget_amount_usd
    }
  }

  # 50% and 90% forecast-based give early warning; 100% actual is the backstop.
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
    spend_basis       = "FORECASTED_SPEND"
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  all_updates_rule {
    monitoring_notification_channels = [google_monitoring_notification_channel.email.id]
    disable_default_iam_recipients   = false
  }
}

data "google_project" "this" {
  project_id = var.project_id
}
```

- [ ] **Step 4: Set the billing account variable**

`var.billing_account` currently defaults to `""`. Add to `/Users/henry/Desktop/fungi/infra/terraform.tfvars` (local only, not committed):

```hcl
billing_account = "019C4F-1AF6A2-161AE4"
```

- [ ] **Step 5: Plan, assert one create, apply**

```bash
cd /Users/henry/Desktop/fungi
terraform -chdir=infra plan -no-color 2>&1 | grep -E "will be (created|destroyed|updated)"
```

Expected: exactly `# google_billing_budget.platform will be created`.

```bash
terraform -chdir=infra apply
```

Expected: `Apply complete! Resources: 1 added, 0 changed, 0 destroyed.`

- [ ] **Step 6: Commit**

```bash
git add infra/budget.tf
git commit -m "infra: add \$60/mo platform budget alert at 50/90/100%

Nothing previously reported a cost spike; the Budget API was not enabled.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Shared `apps` Artifact Registry repo with a cleanup policy

**Repo: fungi.** One registry for every app, so a single cleanup policy governs the whole platform. This matters for cost: the existing `fungi` repo is at 474.9 MB of the 0.5 GB free tier, and propsearch adds roughly 900 MB per deploy across its two images.

**Files:**
- Modify: `/Users/henry/Desktop/fungi/infra/artifact_registry.tf`

- [ ] **Step 1: Append the shared repo**

Add to `/Users/henry/Desktop/fungi/infra/artifact_registry.tf`:

```hcl
# Shared registry for all platform apps: apps/<app>-<service>:<sha>.
# One repo means one cleanup policy and one quota story instead of N.
resource "google_artifact_registry_repository" "apps" {
  project       = var.project_id
  location      = var.region
  repository_id = "apps"
  description   = "Docker images for all platform apps (apps/<app>-<service>)"
  format        = "DOCKER"

  # Untagged layers are build garbage; drop them after a day.
  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "86400s"
    }
  }

  # Keep the last 3 tagged revisions per image for rollback.
  cleanup_policies {
    id     = "keep-recent-tagged"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }

  depends_on = [google_project_service.enabled]
}
```

- [ ] **Step 2: Plan, assert one create, apply**

```bash
cd /Users/henry/Desktop/fungi
terraform -chdir=infra plan -no-color 2>&1 | grep -E "will be (created|destroyed)"
```

Expected: exactly `# google_artifact_registry_repository.apps will be created`.

```bash
terraform -chdir=infra apply
```

Expected: `Apply complete! Resources: 1 added, 0 changed, 0 destroyed.`

- [ ] **Step 3: Verify the repo and its policies exist**

```bash
gcloud artifacts repositories describe apps --location=asia-southeast1 \
  --project fungi-family --format="yaml(name,format,cleanupPolicies)"
```

Expected: `format: DOCKER` and both `delete-untagged` and `keep-recent-tagged` present.

- [ ] **Step 4: Commit**

```bash
git add infra/artifact_registry.tf
git commit -m "infra: add shared 'apps' Artifact Registry repo with cleanup policy

One registry for every platform app so a single cleanup policy governs all
of them. Keeps last 3 tagged versions, drops untagged after 24h -- needed
because the existing fungi repo already sits at 474.9MB of the 0.5GB free
tier and propsearch adds ~900MB per deploy.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Multi-repo WIF provider for app CI

**Repo: fungi.** The existing `github-provider` hard-restricts to a single repo via `attribute_condition = assertion.repository == var.github_repo`, so it cannot serve propsearch. Add a second provider on the same pool with an explicit repo allow-list. fungi's provider is left untouched.

**Files:**
- Modify: `/Users/henry/Desktop/fungi/infra/wif.tf`
- Modify: `/Users/henry/Desktop/fungi/infra/variables.tf`

- [ ] **Step 1: Add the variable**

Append to `/Users/henry/Desktop/fungi/infra/variables.tf`:

```hcl
variable "app_github_repos" {
  description = "GitHub owner/repo allow-list for the shared apps WIF provider. Add one entry per onboarded app."
  type        = list(string)
  default     = ["henrywfyeung/propresearch"]
}
```

- [ ] **Step 2: Add the provider**

Append to `/Users/henry/Desktop/fungi/infra/wif.tf`:

```hcl
# Shared provider for platform apps. Separate from `github-provider`, which is
# pinned to a single repo and serves fungi only. Onboarding an app means adding
# its repo to var.app_github_repos -- one line, no new provider.
resource "google_iam_workload_identity_pool_provider" "apps" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "apps-provider"
  display_name                       = "GitHub OIDC provider (platform apps)"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  attribute_condition = "assertion.repository in [${join(", ", [for r in var.app_github_repos : "\"${r}\""])}]"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

output "apps_wif_provider" {
  description = "Shared apps WIF provider resource name -> GitHub secret WIF_PROVIDER for each app repo"
  value       = google_iam_workload_identity_pool_provider.apps.name
}
```

- [ ] **Step 3: Plan, assert one create, apply**

```bash
cd /Users/henry/Desktop/fungi
terraform -chdir=infra plan -no-color 2>&1 | grep -E "will be (created|destroyed)"
```

Expected: exactly `# google_iam_workload_identity_pool_provider.apps will be created`.

```bash
terraform -chdir=infra apply
```

Expected: `Apply complete! Resources: 1 added, 0 changed, 0 destroyed.`

- [ ] **Step 4: Verify the condition renders correctly**

```bash
gcloud iam workload-identity-pools providers describe apps-provider \
  --location=global --workload-identity-pool=github-pool \
  --project fungi-family --format="value(attributeCondition)"
```

Expected: `assertion.repository in ["henrywfyeung/propresearch"]`

- [ ] **Step 5: Commit**

```bash
git add infra/wif.tf infra/variables.tf
git commit -m "infra(wif): add shared apps-provider with repo allow-list

The existing github-provider pins to a single repo and cannot serve a second
app. New apps-provider on the same pool takes a list, so onboarding an app is
one entry in var.app_github_repos. fungi's provider is untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Build the reusable `modules/app` Terraform module

**Repo: fungi.** This is the deliverable that makes app #3 cheap. Split across four files by responsibility rather than dumped in one `main.tf`.

**Files:**
- Create: `/Users/henry/Desktop/fungi/infra/modules/app/variables.tf`
- Create: `/Users/henry/Desktop/fungi/infra/modules/app/iam.tf`
- Create: `/Users/henry/Desktop/fungi/infra/modules/app/data.tf`
- Create: `/Users/henry/Desktop/fungi/infra/modules/app/run.tf`
- Create: `/Users/henry/Desktop/fungi/infra/modules/app/outputs.tf`

- [ ] **Step 1: Define the module interface**

Create `/Users/henry/Desktop/fungi/infra/modules/app/variables.tf`:

```hcl
variable "project_id" { type = string }
variable "region" { type = string }

variable "app_name" {
  description = "Short app slug. Drives every resource name: <app>-web, <app>-ci, bucket <app>-<purpose>, secrets <app>-<name>, database <app>."
  type        = string
}

variable "github_repo" {
  description = "owner/repo allowed to impersonate this app's CI service account."
  type        = string
}

variable "sql_instance_name" {
  description = "Name of the shared Cloud SQL instance (not the connection name)."
  type        = string
}

variable "sql_connection_name" {
  description = "project:region:instance, passed to Cloud Run as CLOUD_SQL_INSTANCE_CONNECTION_NAME."
  type        = string
}

variable "wif_pool_name" {
  description = "Full resource name of the shared WIF pool."
  type        = string
}

variable "artifact_repo_id" {
  description = "Shared Artifact Registry repository id (e.g. 'apps')."
  type        = string
}

variable "alert_channel_id" {
  description = "Monitoring notification channel id for this app's alert policies."
  type        = string
}

variable "buckets" {
  description = "Bucket purposes to create. Each becomes <app>-<purpose>."
  type        = list(string)
  default     = []
}

variable "secret_names" {
  description = "Secret short names. Each becomes <app>-<name> in Secret Manager. Created empty; populate out-of-band."
  type        = list(string)
  default     = []
}

variable "services" {
  description = <<-EOT
    Cloud Run services for this app, keyed by short name (e.g. "web", "worker").
      cpu / memory  : container resource limits
      timeout       : request timeout in seconds
      max_instances : scaling ceiling; with db_pool_max this sets the connection budget
      db_pool_max   : postgres.js pool size per instance
      public        : true grants allUsers run.invoker
      env           : plain (non-secret) environment variables
      secrets       : subset of var.secret_names this service may read
  EOT
  type = map(object({
    cpu           = string
    memory        = string
    timeout       = number
    max_instances = number
    db_pool_max   = number
    public        = bool
    env           = map(string)
    secrets       = list(string)
  }))
}

variable "image_placeholder" {
  description = "Image used at first apply; the deploy pipeline overwrites it and lifecycle ignores changes."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}
```

- [ ] **Step 2: Service accounts, database, DB users, buckets, secrets, IAM**

Create `/Users/henry/Desktop/fungi/infra/modules/app/iam.tf`:

```hcl
locals {
  # One runtime SA per Cloud Run service, plus one CI SA per app.
  runtime_sa_ids = { for k, v in var.services : k => "${var.app_name}-${k}" }
}

resource "google_service_account" "runtime" {
  for_each     = local.runtime_sa_ids
  project      = var.project_id
  account_id   = each.value
  display_name = "${var.app_name} ${each.key} runtime"
}

resource "google_service_account" "ci" {
  project      = var.project_id
  account_id   = "${var.app_name}-ci"
  display_name = "${var.app_name} GitHub Actions CI"
}

# --- Cloud SQL: one database per app, one IAM DB user per SA ----------------

resource "google_sql_database" "app" {
  project  = var.project_id
  name     = var.app_name
  instance = var.sql_instance_name
}

resource "google_sql_user" "runtime" {
  for_each = google_service_account.runtime
  project  = var.project_id
  instance = var.sql_instance_name
  name     = trimsuffix(each.value.email, ".gserviceaccount.com")
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}

resource "google_sql_user" "ci" {
  project  = var.project_id
  instance = var.sql_instance_name
  name     = trimsuffix(google_service_account.ci.email, ".gserviceaccount.com")
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}

# --- Project-level roles ---------------------------------------------------

resource "google_project_iam_member" "runtime_roles" {
  for_each = {
    for pair in setproduct(keys(var.services), [
      "roles/cloudsql.client",
      "roles/cloudsql.instanceUser",
      "roles/logging.logWriter",
      "roles/monitoring.metricWriter",
      "roles/cloudtrace.agent",
    ]) : "${pair[0]}:${pair[1]}" => { svc = pair[0], role = pair[1] }
  }
  project = var.project_id
  role    = each.value.role
  member  = "serviceAccount:${google_service_account.runtime[each.value.svc].email}"
}

# Deliberately NOT granted here:
#   roles/artifactregistry.writer -- scoped to the shared repo below instead.
#   roles/storage.admin -- project-wide storage would let this app's CI delete
#     another app's buckets. CI needs no storage at all, because plan 2 builds
#     images in the GitHub Actions runner and pushes straight to Artifact
#     Registry rather than staging source through Cloud Build.
#   roles/cloudbuild.builds.editor -- same reason; no Cloud Build in the path.
resource "google_project_iam_member" "ci_roles" {
  for_each = toset([
    "roles/run.developer",
    "roles/cloudsql.client",
    "roles/cloudsql.instanceUser",
    "roles/iam.serviceAccountUser",
  ])
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.ci.email}"
}

# Push rights scoped to the shared registry, not the whole project.
resource "google_artifact_registry_repository_iam_member" "ci_writer" {
  project    = var.project_id
  location   = var.region
  repository = var.artifact_repo_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.ci.email}"
}

# CI must be able to act as each runtime SA to deploy a service as it.
resource "google_service_account_iam_member" "ci_actas_runtime" {
  for_each           = google_service_account.runtime
  service_account_id = each.value.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.ci.email}"
}

# Cloud SQL IAM auth mints tokens against the SA itself.
resource "google_service_account_iam_member" "runtime_token_creator_self" {
  for_each           = google_service_account.runtime
  service_account_id = each.value.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${each.value.email}"
}

# --- Keyless CI: only this repo may impersonate the CI SA ------------------

resource "google_service_account_iam_member" "ci_wif" {
  service_account_id = google_service_account.ci.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${var.wif_pool_name}/attribute.repository/${var.github_repo}"
}

# --- Buckets --------------------------------------------------------------

resource "google_storage_bucket" "app" {
  for_each                    = toset(var.buckets)
  project                     = var.project_id
  name                        = "${var.app_name}-${each.key}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }
}

# Every runtime SA gets objectAdmin on this app's buckets. Access is scoped by
# bucket, not by project, so apps cannot read each other's objects.
resource "google_storage_bucket_iam_member" "runtime_object_admin" {
  for_each = {
    for pair in setproduct(keys(var.services), var.buckets) :
    "${pair[0]}:${pair[1]}" => { svc = pair[0], bucket = pair[1] }
  }
  bucket = google_storage_bucket.app[each.value.bucket].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime[each.value.svc].email}"
}

# --- Secrets --------------------------------------------------------------

resource "google_secret_manager_secret" "app" {
  for_each  = toset(var.secret_names)
  project   = var.project_id
  secret_id = "${var.app_name}-${each.key}"

  replication {
    auto {}
  }
}

# Accessor is granted per-service, per-secret -- never project-wide.
resource "google_secret_manager_secret_iam_member" "runtime_accessor" {
  for_each = {
    for pair in flatten([
      for svc, cfg in var.services : [
        for s in cfg.secrets : { svc = svc, secret = s }
      ]
    ]) : "${pair.svc}:${pair.secret}" => pair
  }
  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.value.secret].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.svc].email}"
}
```

- [ ] **Step 3: Assert the connection budget at plan time**

Create `/Users/henry/Desktop/fungi/infra/modules/app/data.tf`:

```hcl
# The shared instance pins max_connections=60. Fail the plan -- loudly, before
# apply -- if an app's declared budget would eat more than a third of it.
# Budget = sum over services of (max_instances * db_pool_max).
locals {
  connection_budget = sum([
    for k, v in var.services : v.max_instances * v.db_pool_max
  ])
}

check "connection_budget_within_share" {
  assert {
    condition     = local.connection_budget <= 20
    error_message = "App '${var.app_name}' declares a connection budget of ${local.connection_budget}, above the per-app ceiling of 20 against the shared instance's max_connections=60. Reduce max_instances or db_pool_max, or raise the instance tier first."
  }
}
```

- [ ] **Step 4: Cloud Run services and per-app alerts**

Create `/Users/henry/Desktop/fungi/infra/modules/app/run.tf`:

```hcl
resource "google_cloud_run_v2_service" "app" {
  for_each = var.services

  project  = var.project_id
  name     = "${var.app_name}-${each.key}"
  location = var.region

  # Deploys come from CI; Terraform owns shape, not image version.
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime[each.key].email
    timeout         = "${each.value.timeout}s"

    scaling {
      min_instance_count = 0
      max_instance_count = each.value.max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.sql_connection_name]
      }
    }

    containers {
      image = var.image_placeholder

      resources {
        limits = {
          cpu    = each.value.cpu
          memory = each.value.memory
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "CLOUD_SQL_INSTANCE_CONNECTION_NAME"
        value = var.sql_connection_name
      }
      env {
        name  = "DB_NAME"
        value = google_sql_database.app.name
      }
      env {
        name  = "DB_IAM_USER"
        value = trimsuffix(google_service_account.runtime[each.key].email, ".gserviceaccount.com")
      }
      env {
        name  = "DB_POOL_MAX"
        value = tostring(each.value.db_pool_max)
      }

      dynamic "env" {
        for_each = each.value.env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = each.value.secrets
        content {
          # propsearch-openai-api-key -> OPENAI_API_KEY
          name = upper(replace(env.value, "-", "_"))
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = { for k, v in var.services : k => v if v.public }

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app[each.key].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# One 5xx alert per service, on the shared notification channel.
resource "google_monitoring_alert_policy" "service_5xx" {
  for_each = var.services

  project      = var.project_id
  display_name = "${var.app_name}-${each.key} 5xx errors"
  combiner     = "OR"

  conditions {
    display_name = "5xx rate over 5 in 5m"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_revision\"",
        "resource.labels.service_name = \"${var.app_name}-${each.key}\"",
        "metric.type = \"run.googleapis.com/request_count\"",
        "metric.labels.response_code_class = \"5xx\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = [var.alert_channel_id]
}

# Latency alert, thresholded per service off its own request timeout: firing at
# 80% of the timeout catches requests about to be killed. A worker at 900s and a
# web tier at 60s need very different numbers, so this cannot be a constant.
resource "google_monitoring_alert_policy" "service_latency" {
  for_each = var.services

  project      = var.project_id
  display_name = "${var.app_name}-${each.key} p95 latency near timeout"
  combiner     = "OR"

  conditions {
    display_name = "p95 request latency above 80% of the ${each.value.timeout}s timeout"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_revision\"",
        "resource.labels.service_name = \"${var.app_name}-${each.key}\"",
        "metric.type = \"run.googleapis.com/request_latencies\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.timeout * 0.8 * 1000 # metric is milliseconds
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_PERCENTILE_95"
      }
    }
  }

  notification_channels = [var.alert_channel_id]
}
```

- [ ] **Step 5: Module outputs**

Create `/Users/henry/Desktop/fungi/infra/modules/app/outputs.tf`:

```hcl
output "service_urls" {
  description = "Cloud Run URL per service key."
  value       = { for k, v in google_cloud_run_v2_service.app : k => v.uri }
}

output "runtime_service_accounts" {
  description = "Runtime SA email per service key."
  value       = { for k, v in google_service_account.runtime : k => v.email }
}

output "ci_service_account" {
  value = google_service_account.ci.email
}

output "database_name" {
  value = google_sql_database.app.name
}

output "bucket_names" {
  value = { for k, v in google_storage_bucket.app : k => v.name }
}

output "secret_ids" {
  value = { for k, v in google_secret_manager_secret.app : k => v.secret_id }
}

output "connection_budget" {
  description = "Declared Postgres connection budget for this app."
  value       = local.connection_budget
}
```

- [ ] **Step 6: Validate the module compiles**

```bash
cd /Users/henry/Desktop/fungi
terraform -chdir=infra init -upgrade \
  -backend-config="bucket=fungi-family-tfstate" \
  -backend-config="prefix=phase-0"
terraform -chdir=infra validate
```

Expected: `Success! The configuration is valid.`

An unused module produces no plan diff yet — that is expected. Task 8 instantiates it.

- [ ] **Step 7: Commit**

```bash
git add infra/modules/
git commit -m "infra: add reusable modules/app for platform app onboarding

Creates per app: runtime SA per Cloud Run service, a CI SA with keyless WIF
binding, a Cloud SQL database with IAM DB users, buckets, secrets with
per-service accessor bindings, Cloud Run services, and 5xx + latency alerts.

CI is deliberately given neither project-wide storage.admin nor
artifactregistry.writer -- project-wide storage would let one app's CI delete
another app's buckets. Registry access is scoped to the shared repo, and CI
needs no storage because images build in the Actions runner and push straight
to Artifact Registry.

Includes a plan-time check{} asserting the app's connection budget
(sum of max_instances * db_pool_max) stays within its share of the shared
instance's max_connections=60. Onboarding app #3 is now ~25 lines.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Instantiate the module for propsearch

**Repo: fungi.** The ~25 lines that prove the module works.

**Files:**
- Create: `/Users/henry/Desktop/fungi/infra/apps/propsearch.tf`

- [ ] **Step 1: Write the instantiation**

Create `/Users/henry/Desktop/fungi/infra/apps/propsearch.tf`:

```hcl
# propsearch: NSW/VIC property research assistant.
# Two services: a light web tier, and a Chromium-bearing worker that serves
# only /api/inngest and renders PDFs.
# Connection budget: 3*2 + 4*2 = 14, within the per-app ceiling of 20.

module "propsearch" {
  source = "../modules/app"

  project_id          = var.project_id
  region              = var.region
  app_name            = "propsearch"
  github_repo         = "henrywfyeung/propresearch"
  sql_instance_name   = google_sql_database_instance.fungi.name
  sql_connection_name = google_sql_database_instance.fungi.connection_name
  wif_pool_name       = google_iam_workload_identity_pool.github.name
  artifact_repo_id    = google_artifact_registry_repository.apps.repository_id
  alert_channel_id    = google_monitoring_notification_channel.email.id

  buckets = ["reports"]

  secret_names = [
    "session-secret",
    "google-oauth-client-id",
    "google-oauth-client-secret",
    "openai-api-key",
    "rapidapi-key",
    "mapbox-token",
    "google-maps-key",
    "inngest-event-key",
    "inngest-signing-key",
  ]

  services = {
    web = {
      cpu           = "1"
      memory        = "1Gi"
      timeout       = 60
      max_instances = 3
      db_pool_max   = 2
      public        = true
      env = {
        APP_ENV        = "production"
        GCS_BUCKET     = "propsearch-reports"
        LOG_LEVEL      = "info"
        RAPIDAPI_REA_HOST = "realty-in-au.p.rapidapi.com"
      }
      secrets = [
        "session-secret",
        "google-oauth-client-id",
        "google-oauth-client-secret",
        "inngest-event-key",
      ]
    }

    worker = {
      cpu           = "2"
      memory        = "2Gi"
      timeout       = 900
      max_instances = 4
      db_pool_max   = 2
      # Inngest cannot send OIDC tokens, so ingress is open and the request is
      # authenticated by INNGEST_SIGNING_KEY. Same pattern as fungi's GCIP
      # blocking functions.
      public        = true
      env = {
        APP_ENV      = "production"
        GCS_BUCKET   = "propsearch-reports"
        LOG_LEVEL    = "info"
        CHROME_PATH  = "/usr/bin/chromium"
        RAPIDAPI_REA_HOST = "realty-in-au.p.rapidapi.com"
      }
      secrets = [
        "session-secret",
        "openai-api-key",
        "rapidapi-key",
        "mapbox-token",
        "google-maps-key",
        "inngest-event-key",
        "inngest-signing-key",
      ]
    }
  }
}

output "propsearch_web_url" {
  value = module.propsearch.service_urls["web"]
}

output "propsearch_worker_url" {
  value = module.propsearch.service_urls["worker"]
}

output "propsearch_ci_service_account" {
  value = module.propsearch.ci_service_account
}

output "propsearch_connection_budget" {
  value = module.propsearch.connection_budget
}
```

Confirm `RAPIDAPI_REA_HOST` against propsearch's `.env.local` before applying; if it differs, use the real value. Do not guess.

- [ ] **Step 2: Add propsearch to the WIF allow-list if not already present**

`var.app_github_repos` already defaults to `["henrywfyeung/propresearch"]` from Task 6. Verify:

```bash
grep -A4 'variable "app_github_repos"' /Users/henry/Desktop/fungi/infra/variables.tf
```

Expected: the default list contains `henrywfyeung/propresearch`.

- [ ] **Step 3: Plan and assert nothing existing is touched**

```bash
cd /Users/henry/Desktop/fungi
terraform -chdir=infra init -upgrade \
  -backend-config="bucket=fungi-family-tfstate" \
  -backend-config="prefix=phase-0"
terraform -chdir=infra plan -no-color 2>&1 | tee /tmp/propsearch-plan.txt

grep -c "will be destroyed" /tmp/propsearch-plan.txt
grep "will be created" /tmp/propsearch-plan.txt | grep -vc "module.propsearch"
```

Expected: `0` destroys, and `0` creates outside `module.propsearch`. **This is the Phase 0 acceptance test from the spec: additions only, zero changes to fungi.**

If the `check` block fails here with a connection-budget error, the plan output says exactly which numbers to reduce. Do not raise the ceiling to make it pass.

- [ ] **Step 4: Apply**

```bash
terraform -chdir=infra apply
```

Expected: `Apply complete!` with roughly 40 resources added and `0 destroyed`.

- [ ] **Step 5: Verify the live result**

```bash
terraform -chdir=infra output propsearch_connection_budget
gcloud run services list --project fungi-family --region asia-southeast1 \
  --format="table(metadata.name,status.url)"
gcloud sql databases list --instance fungi-db --project fungi-family --format="value(name)"
gcloud storage buckets describe gs://propsearch-reports --format="value(name)"
```

Expected: budget `14`; four Cloud Run services (two fungi, two propsearch); databases include both `fungi` and `propsearch`; the bucket exists.

- [ ] **Step 6: Commit**

```bash
git add infra/apps/
git commit -m "infra(propsearch): onboard propsearch via modules/app

Two Cloud Run services (web 1CPU/1Gi/60s, worker 2CPU/2Gi/900s), a
propsearch database on the shared instance, propsearch-reports bucket,
9 empty secrets with per-service accessor bindings, and 5xx alerts.

Declared connection budget 14, within the per-app ceiling of 20.
Plan verified as additions-only with zero changes to fungi resources.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Create the OAuth client and populate secrets

**Repo: fungi** (no file changes; this task is console + gcloud). The OAuth consent screen cannot be managed by Terraform, so the client is created by hand and its credentials land in the secrets created by Task 8.

**Files:** none

- [ ] **Step 1: Create the OAuth client in the Cloud Console**

Navigate to **APIs & Services → Credentials → Create Credentials → OAuth client ID** in project `fungi-family`.

- Application type: **Web application**
- Name: `propsearch-web`
- Authorised redirect URIs — add both:
  - `http://localhost:3000/auth/callback`
  - `<propsearch_web_url>/auth/callback`, using the URL from `terraform output propsearch_web_url`

This must be a **new** client, not fungi's existing `505888948678-b8hkv00l...` — the whole point of the plain-OAuth decision is that the two apps share no identity surface.

Record the client ID and client secret.

- [ ] **Step 2: Populate the OAuth secrets**

```bash
printf '%s' '<CLIENT_ID>' | gcloud secrets versions add propsearch-google-oauth-client-id \
  --project fungi-family --data-file=-
printf '%s' '<CLIENT_SECRET>' | gcloud secrets versions add propsearch-google-oauth-client-secret \
  --project fungi-family --data-file=-
```

Expected: `Created version [1] of the secret [...]` for each.

- [ ] **Step 3: Generate and store the session secret**

```bash
openssl rand -base64 48 | tr -d '\n' \
  | gcloud secrets versions add propsearch-session-secret --project fungi-family --data-file=-
```

Expected: `Created version [1] of the secret [propsearch-session-secret].`

Do not echo this value.

- [ ] **Step 4: Copy the existing third-party keys from `.env.local`**

These already exist and are simply relocating. Run from the propsearch repo so `.env.local` resolves:

```bash
cd /Users/henry/Desktop/propsearch
for pair in \
  "OPENAI_API_KEY:propsearch-openai-api-key" \
  "RAPIDAPI_KEY:propsearch-rapidapi-key" \
  "MAPBOX_TOKEN:propsearch-mapbox-token" \
  "GOOGLE_MAPS_KEY:propsearch-google-maps-key"
do
  var="${pair%%:*}"; secret="${pair##*:}"
  val=$(grep "^${var}=" .env.local | cut -d= -f2-)
  if [ -z "$val" ]; then echo "SKIP $var (empty)"; continue; fi
  printf '%s' "$val" | gcloud secrets versions add "$secret" --project fungi-family --data-file=-
done
```

Expected: `Created version [1]` for all four.

- [ ] **Step 5: Note the Inngest keys as deliberately deferred**

`INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are empty in `.env.local` — they were provisioned by the Inngest↔Vercel integration, which has no GCP analogue. They come from the Inngest dashboard during plan 3 cutover, once the worker URL is registered. Leave both secrets versionless for now.

- [ ] **Step 6: Verify every secret except the two Inngest ones has a version**

```bash
for s in session-secret google-oauth-client-id google-oauth-client-secret \
         openai-api-key rapidapi-key mapbox-token google-maps-key; do
  n=$(gcloud secrets versions list "propsearch-$s" --project fungi-family \
        --filter="state=ENABLED" --format="value(name)" | wc -l | tr -d ' ')
  echo "propsearch-$s: $n enabled version(s)"
done
```

Expected: `1 enabled version(s)` for all seven.

There is nothing to commit — no secret material or file changes belong in git.

---

## Task 10: Record the platform contract and hand off

**Repo: propsearch** (branch `feat/gcp-migration`). Capture the live facts a future session or a new app needs, in the same spirit as fungi's `GCP_RESOURCES.md`.

**Files:**
- Create: `/Users/henry/Desktop/propsearch/docs/gcp-platform.md`

- [ ] **Step 1: Gather the live values to document**

```bash
cd /Users/henry/Desktop/fungi
terraform -chdir=infra output
```

Record `propsearch_web_url`, `propsearch_worker_url`, `propsearch_ci_service_account`, `apps_wif_provider`.

- [ ] **Step 2: Write the doc**

Create `/Users/henry/Desktop/propsearch/docs/gcp-platform.md`:

```markdown
# propsearch on the fungi-family GCP platform

propsearch runs in the shared `fungi-family` project (`asia-southeast1`). Platform
Terraform lives in the **fungi** repo at `infra/`; propsearch is onboarded by
`infra/apps/propsearch.tf` calling `infra/modules/app`.

## Services
| | URL | SA | Shape |
|---|---|---|---|
| `propsearch-web` | <propsearch_web_url> | `propsearch-web@fungi-family.iam` | 1 vCPU / 1 GiB / 60 s / max 3 |
| `propsearch-worker` | <propsearch_worker_url> | `propsearch-worker@fungi-family.iam` | 2 vCPU / 2 GiB / 900 s / max 4 |

Both are allow-unauth. The web service authenticates users itself; the worker
serves only `/api/inngest` and is gated by `INNGEST_SIGNING_KEY`, because
Inngest cannot send OIDC tokens. No load balancer — Inngest is pointed
directly at the worker URL, which avoids ~$18/mo.

## Database
Database `propsearch` inside the **shared** instance
`fungi-family:asia-southeast1:fungi-db`. IAM auth, no passwords. Reached over
the Cloud Run Unix socket at `/cloudsql/<conn>/.s.PGSQL.5432`.

`max_connections` is pinned at **60** for the whole instance. propsearch's
budget is **14** (web 3×2 + worker 4×2); the module enforces a per-app ceiling
of 20 with a plan-time `check{}`.

**Table-ownership trap:** migrations applied by `propsearch-ci` are owned by
that role and invisible to the runtime SAs until granted. The deploy pipeline
must run a grant step, not just `db:migrate`.

## Storage
Private bucket `gs://propsearch-reports` (uniform access, public-access
prevention, versioned). Accessed via ADC on the runtime SAs — there are no
storage credentials in env. `reports.pdf_url` holds an **object key**, not a URL.

## Secrets
`propsearch-*` in Secret Manager, accessor bound per-service:
`session-secret`, `google-oauth-client-id`, `google-oauth-client-secret`,
`openai-api-key`, `rapidapi-key`, `mapbox-token`, `google-maps-key`,
`inngest-event-key`, `inngest-signing-key`.

The two Inngest secrets are intentionally versionless until cutover.

## CI
Keyless via WIF. GitHub secrets for this repo:
- `WIF_PROVIDER` = <apps_wif_provider>
- `WIF_SERVICE_ACCOUNT` = <propsearch_ci_service_account>

Images go to the shared registry: `asia-southeast1-docker.pkg.dev/fungi-family/apps/propsearch-{web,worker}:<sha>`.
Cleanup policy keeps the last 3 tagged versions and drops untagged after 24 h.

## Onboarding another app
Add `infra/apps/<app>.tf` calling `modules/app`, add the repo to
`var.app_github_repos`, and apply. Budget the new app's connections against
the instance's 60 before raising `max_instances`.

## Known follow-ups
- Migrate fungi itself into `modules/app` (blocked on importing its live drift).
- Extract platform Terraform into a dedicated `platform` repo.
- No LangGraph checkpointer is wired, so a crashed report loses all work.
```

Replace every `<placeholder>` with the real value from Step 1. Leaving a
placeholder in this file is a task failure.

- [ ] **Step 3: Verify no placeholders survive**

```bash
cd /Users/henry/Desktop/propsearch
grep -n "<propsearch_\|<apps_wif" docs/gcp-platform.md || echo "clean"
```

Expected: `clean`

- [ ] **Step 4: Commit**

```bash
git add docs/gcp-platform.md
git commit -m "docs: record the propsearch GCP platform contract

Live service URLs, the shared-instance connection budget, the CI/WIF wiring,
and how to onboard the next app.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Push both branches**

```bash
cd /Users/henry/Desktop/fungi && git push -u origin feat/platform-groundwork
cd /Users/henry/Desktop/propsearch && git push -u origin feat/gcp-migration
```

---

## Done when

- `terraform -chdir=infra plan` is clean: 0 to add, 0 to destroy.
- Four Cloud Run services exist; the two propsearch ones return HTTP 200 from the placeholder image.
- `fungi-db` reports `deletionProtectionEnabled: True`, `storageAutoResizeLimit: 20`, `max_connections: 60`.
- Alert policies exist for: fungi-db connections >42, and 5xx + p95 latency on each of the four Cloud Run services.
- Databases `fungi` and `propsearch` both exist on the shared instance.
- `gs://propsearch-reports` exists and is private.
- Seven of nine `propsearch-*` secrets have an enabled version; the two Inngest ones are deliberately empty.
- A `$60/mo` budget alert exists.
- `docs/gcp-platform.md` has no placeholders.

**Not done in this plan** (plan 2): any propsearch application code, the Dockerfile, the deploy workflow, schema migrations, or data movement. The Cloud Run services intentionally still run `cloudrun/container/hello`.
