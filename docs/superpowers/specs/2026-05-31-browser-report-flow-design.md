# Design: Browser-driven report generation (v1, no Inngest)

- **Date:** 2026-05-31
- **Status:** Design (autonomous; builds on the validated live pipeline + the webapp spine)
- **Scope:** Turn the working `generateReport` orchestrator into a usable in-browser flow: trigger a report from a form → watch live per-node progress → view + download the PDF. **No Inngest, no email, no versioning/regen, no dedupe dialog yet** (later upgrades).

---

## 1. Context

The content pipeline is validated end-to-end on live data (geocode → REA comps → gpt-5.4 reasoning → triangulate → compose → Puppeteer PDF → S3, ~$0.075/report). Auth is fully built (Supabase session middleware + `requireAllowedUser` allow-list gate + OAuth callback). `generateReport({userId, rawAddress, rawSubject})` creates a row, runs the graph, and persists the outcome. **Missing:** every request/UI surface, live progress, and PDF streaming.

### Execution model decision — Vercel `after()`, not Inngest (v1)

A report takes ~92s. Options weighed:
- **Synchronous** (await in the POST handler): fits Vercel Pro's 300s, but the browser blocks ~92s on one request and no progress is possible. Rejected.
- **Inngest** (durable queue): the eventual production answer (resumption, retries) but needs a new account (deferred — billing-adjacent) and the checkpointer wiring. Deferred.
- **Vercel `after()`** (`unstable_after` from `next/server`, Next 15.0.3): the POST creates the row + returns `{id}` immediately, then runs `generateReport` *after the response* within the same invocation (bounded by `maxDuration=300`). The client redirects to the detail page and polls. **Chosen for v1** — creds-free, decent UX, single-user appropriate. Trade-off: no resumption if the function crashes mid-run (the row is left `running`; acceptable for one user, and a later Inngest swap fixes it).

`generateReport`'s body is unchanged in spirit; only the *invoker* changes (an API route via `after()` instead of a script). When Inngest lands, the same `generateReport` becomes the function body.

---

## 2. Pieces to build

### 2.1 `reports.currentNode` progress tracking
`runGraph` gains an optional `onNode?: (node: string) => void | Promise<void>` callback, invoked as each graph node completes (via `reportGraph.stream(...)` instead of `.invoke(...)`, mapping the streamed node key). `generateReport` passes an `onNode` that writes `currentNode` through a new `markNode(reportId, node)` helper in `src/db/reports.ts`. No checkpointer needed.

- `src/agents/graph.ts`: `runGraph(input, opts?: { onNode? })` — stream, call `onNode(node)` per completed node, return the final state (same shape as today).
- `src/db/reports.ts`: `markNode(id, currentNode)` → `update reports set currentNode, updatedAt`.
- `src/agents/generateReport.ts`: pass `onNode: (n) => markNode(reportId, n)`.

### 2.2 `POST /api/reports` — trigger
- `requireAllowedUser()` (Node runtime). Zod-validate body `{ rawAddress: string, subject: {...attrs} }`.
- `createReport(userId)` → `reportId`. Schedule `after(() => generateReport({ userId, rawAddress, rawSubject }))` — but `generateReport` creates its own row; refactor so the route either (a) calls `generateReport` which creates the row and returns the id synchronously *before* the graph runs, or (b) split `generateReport` into `createReport` (route, returns id now) + `runReport(reportId, ...)` (in `after()`). **Choose (b):** add `runReport(reportId, input)` that does markRunning→runGraph→mark\*; the route calls `createReport`, returns `{id}`, and `after(() => runReport(id, input))`. Keeps the id available immediately for the redirect.
- `maxDuration = 300` exported from the route.
- Returns `{ id }` (201).

### 2.3 `GET /api/reports/[id]` — status poll
- `requireAllowedUser()`; fetch the row by `id` (ownership: must belong to the user — query `where id = $1 and userId = $2`).
- Return `{ status, currentNode, percentage, pdfUrl, errorMessage, subjectAddress }`. `percentage` = index of `currentNode` in the known node order / total (§15.2 mapping), clamped; 100 when succeeded.
- Top-level columns only (passes the §4.3 cross-row ESLint guard — it's a by-id query anyway).

### 2.4 `GET /reports/[id]/pdf` — proxied download (§7.15)
- `requireAllowedUser()` + ownership check; load `pdfUrl` (the S3 key).
- New `src/tools/storage/s3.ts` `getPdfStream(key)` (or `getPdfBytes(key)`) — server-side `GetObjectCommand`; stream bytes back with `Content-Type: application/pdf` + `Content-Disposition: attachment`. The signed URL / object never leaves the server (no public URL, no redirect).

### 2.5 `/reports/new` — form (client component)
- Fields: address (text), and subject attrs (beds/baths/parking/landArea/propertyType; buildingArea optional). Minimal, no Domain autocomplete (out per pivot — user types the address).
- Submit → `POST /api/reports` → on `{id}` redirect to `/reports/[id]`.

### 2.6 `/reports/[id]` — progress + result (client component, polls)
- Polls `GET /api/reports/[id]` every 2s while `status ∈ {queued, running}`.
- `running`: render the node stepper with §15.2 labels ("Resolving address…", "Finding comparable sales…", "Selecting best comparables…", "Triangulating value…", "Writing the report…", "Rendering PDF…") highlighting `currentNode`.
- `succeeded`: show summary (subjectAddress) + a "Download PDF" button (→ `/reports/[id]/pdf`). (Inline PDF preview deferred.)
- `failed`: show `errorMessage` + a link back to `/reports/new`.

### 2.7 Dashboard `/` — list (enhance the existing skeleton)
- Replace "No reports yet" with the user's reports (by `userId`, newest first): subjectAddress, status chip, createdAt, link to `/reports/[id]`. Top-level columns only.

---

## 3. Out of scope (later)
- Inngest durability + `/api/inngest` + checkpointer; email (Resend) + email-status; versioning/regen + `report_versions`; the firm-wide dedupe dialog; rate-limit + cost-ceiling enforcement at node boundaries; inline PDF preview; the remaining dossier nodes (vision/street-view/risks/planning).

## 4. Testing
- **Unit:** `runGraph onNode` fires per node (mock the graph stream); `markNode` issues the right update; `runReport` sequences markRunning→runGraph→mark\*; status route computes `percentage` + enforces ownership; PDF route streams with the right headers + 404/403 on missing/again-not-owned; trigger route validates the body + returns `{id}` + schedules work. Mock Supabase auth, the graph, S3, and `after()`.
- **Manual:** `scripts/run-report-live.ts` already covers the pipeline; add a manual check that the dev server serves `/reports/new` → progress → download against a real run (separate, creds-on).

## 5. Definition of done
- All routes + pages implemented; `runGraph onNode` + `markNode` + `runReport` in place; `getPdf*` in s3.ts.
- `pnpm typecheck && pnpm lint && pnpm test` green; CLAUDE.md untouched; no new deps; no new credentials (uses Supabase/S3/pipeline creds already configured).
- Per-node progress visible while running; PDF downloads via the proxied route.
