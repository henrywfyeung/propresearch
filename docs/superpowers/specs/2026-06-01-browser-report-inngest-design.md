# Design: Browser report flow on Inngest

- **Date:** 2026-06-01
- **Status:** Design (autonomous; user: "wire up the browser UI with inngest"). Supersedes the `after()` execution model in `2026-05-31-browser-report-flow-design.md` (the UI/route shapes there still apply).
- **Scope:** Turn the working pipeline into an in-browser flow on **Inngest** (durable queue): trigger from a form → Inngest runs the report → watch live per-node progress → view + download the PDF. **Build everything; the LIVE run/deploy pauses for `INNGEST_*` keys + an Inngest account (currently empty).** No email yet (Resend deferred). Auth is already built.

## 1. Execution model — Inngest (single-step v1)
- A report takes ~200–250s (high-effort reasoning ~174s + comps/risks/planning + compose + render). That fits one Vercel Pro invocation (300s), so **v1 is a single Inngest function with one `step.run` calling `runReport`** — no `graphSlice` splitting, no `PostgresSaver` checkpointer yet. Inngest gives durability (retry on failure), concurrency caps, and decouples the long run from the HTTP request.
- **Margin note:** ~250s is close to 300s. If high-effort runs ever exceed it, the hardening is the CLAUDE.md §6.4 6-step `graphSlice` + checkpointer — a documented follow-up, NOT v1.
- **Build-vs-creds split:** all code is built + unit-tested with Inngest/Supabase/S3 mocked. The pieces that need real `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` + an Inngest account to *run* (event send, webhook signature, the live durable run) are validated only after the user provides them.

## 2. Progress plumbing
- **`src/agents/graph.ts`** — `runGraph(input, opts?: { onNode?: (node: string) => void | Promise<void> })`: switch the internal `reportGraph.invoke(...)` to `reportGraph.stream(..., { streamMode: 'updates' })`, iterate, call `await opts?.onNode(nodeName)` as each node completes, and return the final aggregated state (same shape/return as today — accumulate updates or read the final chunk). No behaviour change when `onNode` is omitted.
- **`src/db/reports.ts`** — `markNode(id: string, currentNode: string): Promise<void>` → `update reports set currentNode, updatedAt where id`.
- **`src/agents/generateReport.ts`** — split: keep `createReport` in `@/db/reports`; add **`runReport(reportId: string, input: { rawAddress: string; rawSubject: unknown }): Promise<void>`** = `markRunning` → `buildSubject` → `runGraph({reportId, rawAddress, subject}, { onNode: (n) => markNode(reportId, n) })` → `markSucceeded`/`markFailed` (mirror the current orchestrator's try/catch + "render produced no PDF" guard). The existing `generateReport({userId,...})` may remain as `createReport`+`runReport` for scripts, or be removed in favour of the two pieces — implementer's call, keep tests green.

## 3. Inngest function + client + webhook
- **`src/inngest/client.ts`** — `export const inngest = new Inngest({ id: 'propresearch', eventKey: process.env.INNGEST_EVENT_KEY })`. Define the event type `{ name: 'reports/generate.requested', data: { reportId: string; userId: string; rawAddress: string; rawSubject: unknown } }`.
- **`src/inngest/functions/generateReport.ts`** — `inngest.createFunction({ id: 'reports/generate', retries: 1, concurrency: [{ scope:'fn', limit:4 }, { scope:'fn', key:'event.data.userId', limit:2 }] }, { event:'reports/generate.requested' }, async ({event,step}) => { await step.run('run-report', () => runReport(event.data.reportId, { rawAddress: event.data.rawAddress, rawSubject: event.data.rawSubject })); })`. (Quota increment / email are later; §12 of CLAUDE.md is the eventual fuller shape.)
- **`src/app/api/inngest/route.ts`** — `serve({ client: inngest, functions: [generateReportFn] })` from `inngest/next`, exporting `GET/POST/PUT`. Signature verification is handled by `serve()` via `INNGEST_SIGNING_KEY` ([R45]). The middleware matcher already excludes `/api/inngest`.

## 4. Trigger + status routes
- **`POST /api/reports`** (`src/app/api/reports/route.ts`, `export const runtime = 'nodejs'`): `requireAllowedUser()` → Zod-validate body `{ rawAddress: string, subject: {...attrs} }` → `createReport(userId)` → `inngest.send({ name:'reports/generate.requested', data:{ reportId, userId, rawAddress, rawSubject: subject } })` → `201 { id }`.
- **`GET /api/reports/[id]`** (`src/app/api/reports/[id]/route.ts`): `requireAllowedUser()` → fetch row `where id=$1 and userId=$2` (ownership) → `{ status, currentNode, percentage, pdfUrl, errorMessage, subjectAddress }`. `percentage` = index of `currentNode` in the known node order ÷ total, clamped; 100 when succeeded. Top-level columns only (passes the §4.3 cross-row ESLint guard — it's by-id anyway).

## 5. Proxied PDF download (§7.15)
- **`src/tools/storage/s3.ts`** — add `getPdf(key: string): Promise<Uint8Array>` (server-side `GetObjectCommand`; never expose a public/signed URL to the client).
- **`GET /reports/[id]/pdf`** (`src/app/reports/[id]/pdf/route.ts`): `requireAllowedUser()` + ownership → load `pdfUrl` (the S3 key) → stream bytes back with `Content-Type: application/pdf` + `Content-Disposition: attachment; filename="report-<id>.pdf"`. 404 if missing, 403 if not owned.

## 6. Pages (client components; reuse the existing Tailwind/shadcn setup)
- **`/reports/new`** — form: address + subject attrs (beds/baths/parking/landArea/propertyType; buildingArea optional). Submit → `POST /api/reports` → redirect to `/reports/[id]`. (No Domain autocomplete — user types the address.)
- **`/reports/[id]`** — poll `GET /api/reports/[id]` every 2s while `status ∈ {queued,running}`. `running` → a node stepper with §15.2 labels (Resolving address… / Finding comparable sales… / Assessing risks… / Pulling planning activity… / Selecting comparables… / Triangulating value… / Writing the report… / Rendering PDF…) highlighting `currentNode`. `succeeded` → subjectAddress + a "Download PDF" button (→ `/reports/[id]/pdf`). `failed` → `errorMessage` + a link to `/reports/new`.
- **Dashboard `/`** — replace the "No reports yet" skeleton with the user's reports (by `userId`, newest first): subjectAddress, status chip, createdAt, link to `/reports/[id]`. Top-level columns only.

## 7. What needs creds (pause points — build + unit-test now, validate later)
- `inngest.send` (POST /api/reports) needs `INNGEST_EVENT_KEY`; `serve()` webhook needs `INNGEST_SIGNING_KEY`; the live durable run needs an Inngest account registered to the deployed `/api/inngest`. Unit tests mock `@/inngest/client` (`inngest.send`) and `runReport`. The dev-server live run + deploy are the deferred validation.
- Supabase Google-OAuth provider + allow-list seeding are runtime config (the user's Supabase project) — the auth *code* is already built.

## 8. Testing
- **Unit:** `runGraph onNode` fires per node (mock the graph stream); `markNode` issues the right update; `runReport` sequences markRunning→runGraph→markSucceeded/Failed (+ "render produced no PDF"); status route computes `percentage` + enforces ownership (403/404); PDF route streams with the right headers + 404/403; trigger route validates the body, calls `createReport`, sends the Inngest event (mock `inngest.send`), returns `{id}`; the Inngest function calls `runReport` with the event data (mock `runReport`, invoke the function's handler directly). Mock Supabase auth (`requireAllowedUser`), the graph, S3, Inngest.
- **Manual (deferred, needs creds):** `npx inngest-cli dev` + `pnpm dev`, drive `/reports/new` → progress → download against a real run.

## 9. Definition of done (build phase)
- All routes/pages/Inngest code + progress plumbing implemented; `getPdf` in s3.ts. `pnpm typecheck && pnpm lint && pnpm test` green; CLAUDE.md untouched; no new deps (inngest already installed); no new credentials required to BUILD/TEST. A clearly-documented "to go live, set INNGEST_* + register the Inngest app" note in the PR/summary.
