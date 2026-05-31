# Design: Webapp spine — report persistence + `generateReport` orchestrator

- **Date:** 2026-05-31
- **Status:** Design (autonomous; creds-free; parallel to the OpenAI setup)
- **Scope:** The backend spine that turns a request into a stored, rendered report — DB persistence helpers + an orchestrator that runs the graph and records the outcome. **No Inngest, no UI, no email yet** (those are follow-ons; Inngest/Resend need their own keys).

---

## 1. Context & why it's parallelizable

The graph (`runGraph`) is built and produces `{ resolvedAddress, comparables, triangulation, prose, pdfUrl }`. The webapp wraps it; nothing here calls OpenAI directly — tests mock the graph. So this builds + tests with **zero credentials** (the graph/LLM/S3 are mocked), in parallel with the owner setting up OpenAI/S3. It depends only on already-built pieces: the graph, the DB schema (`reports` table), and `buildSubject`.

Runs in the worker context (same as the graph's `llm_calls` writes), so persistence uses `workerDb` (`@/db/client-worker`, session-mode pool, §16.3).

## 2. Persistence helpers — `src/db/reports.ts`

```ts
import { workerDb } from '@/db/client-worker';
import { reports } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function createReport(userId: string): Promise<string> {
  const [row] = await workerDb
    .insert(reports)
    .values({ userId, status: 'queued' })
    .returning({ id: reports.id });
  if (!row) throw new Error('createReport: insert returned no row');
  return row.id;
}

export async function markRunning(id: string): Promise<void> {
  await workerDb.update(reports).set({ status: 'running', updatedAt: new Date() }).where(eq(reports.id, id));
}

export interface ReportSuccess {
  pdfUrl: string;
  subjectAddress: string | null;
}

export async function markSucceeded(id: string, r: ReportSuccess): Promise<void> {
  await workerDb
    .update(reports)
    .set({ status: 'succeeded', pdfUrl: r.pdfUrl, subjectAddress: r.subjectAddress, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(reports.id, id));
}

export async function markFailed(id: string, errorMessage: string): Promise<void> {
  await workerDb
    .update(reports)
    .set({ status: 'failed', errorMessage, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(reports.id, id));
}
```

(`totalCostUsd`/`totalTokens` deferred — they'd come from a `sum(llm_calls.cost_usd)` after the run; not needed for v1.)

## 3. Orchestrator — `src/agents/generateReport.ts`

```ts
import { runGraph } from '@/agents/graph';
import { buildSubject } from '@/agents/subject';
import { createReport, markFailed, markRunning, markSucceeded } from '@/db/reports';
import { logger } from '@/lib/observability/logger';

export interface GenerateReportInput {
  userId: string;
  rawAddress: string;
  rawSubject: unknown; // validated by buildSubject
}

export async function generateReport(input: GenerateReportInput): Promise<string> {
  const reportId = await createReport(input.userId);
  await markRunning(reportId);
  try {
    const subject = buildSubject(input.rawSubject);
    const state = await runGraph({ reportId, rawAddress: input.rawAddress, subject });
    if (!state.pdfUrl) {
      await markFailed(reportId, 'render produced no PDF');
      return reportId;
    }
    await markSucceeded(reportId, {
      pdfUrl: state.pdfUrl,
      subjectAddress: state.resolvedAddress?.normalizedAddress ?? null,
    });
  } catch (err) {
    logger.error({ err, reportId }, 'generateReport failed');
    await markFailed(reportId, err instanceof Error ? err.message : String(err));
  }
  return reportId;
}
```

Always returns the `reportId` (created up front), so a caller can navigate to it even if generation fails. `buildSubject` throwing (bad input) is caught → `markFailed`.

## 4. Testing

- **`tests/unit/reports-db.test.ts`**: `vi.mock('@/db/client-worker')` with a chainable `workerDb` stub (`insert().values().returning()`, `update().set().where()`). Assert `createReport` returns the inserted id, and each `mark*` issues the right `update().set({...})` payload (status + fields). `createReport` throws if `returning` yields no row.
- **`tests/unit/generateReport.test.ts`**: `vi.mock('@/db/reports')` (the helpers) + `vi.mock('@/agents/graph')` (`runGraph`) + `vi.mock('@/agents/subject')` (`buildSubject`). Assert the sequence: `createReport` → `markRunning` → `runGraph({reportId, rawAddress, subject})` → `markSucceeded({pdfUrl, subjectAddress})` on a state with a `pdfUrl`; `markFailed` when `runGraph` throws; `markFailed('render produced no PDF')` when `state.pdfUrl` is null; the returned id is the created one.

## 5. Out of scope (follow-ons)

- **Inngest** `generateReport` function + `/api/inngest` webhook (needs `INNGEST_*` keys) — this orchestrator is its body.
- **Trigger + status routes** (`POST /api/reports`, `GET /api/reports/[id]`) and the **reports pages** (new / list / detail).
- **Proxied PDF download route** (`/reports/[id]/pdf`, signed-URL stream).
- **Email** (Resend) + the email-status surface.
- **Cost/tokens** persistence, dedupe dialog, rate-limit counter increment, `report_versions` row.
- **Supabase Google-OAuth provider** enablement + allow-list seeding (run-time config).

## 6. Definition of done

- `src/db/reports.ts` + `src/agents/generateReport.ts` implemented; both unit-tested (graph + db mocked).
- `pnpm typecheck && pnpm lint && pnpm test` green; `CLAUDE.md` untouched.
- No new dependencies, no credentials required to build/test.
