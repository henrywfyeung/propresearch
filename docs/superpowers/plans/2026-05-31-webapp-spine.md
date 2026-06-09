# Webapp spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the creds-free backend spine — report persistence helpers + a `generateReport` orchestrator (create row → run graph → persist outcome).

**Architecture:** Two tasks — (1) `src/db/reports.ts` (workerDb persistence), (2) `src/agents/generateReport.ts` (orchestration). Both unit-tested with the graph + DB mocked. No Inngest/UI/email here; no new deps; no credentials.

**Tech Stack:** Drizzle (`@/db/client-worker` workerDb), Vitest 2.1 (module mocks), Biome. `@/` → `src/`. `noUncheckedIndexedAccess` on.

**Reference spec:** `docs/superpowers/specs/2026-05-31-webapp-spine-design.md`

**Verified:** `reports` table columns (`id, userId, status, pdfUrl, subjectAddress, errorMessage, completedAt, updatedAt`, …) in `src/db/schema.ts`; `workerDb` exported from `src/db/client-worker.ts`; `runGraph` (`@/agents/graph`), `buildSubject` (`@/agents/subject`), `logger` (`@/lib/observability/logger`). `reports.status` enum includes `queued|running|succeeded|failed`.

---

## File map

| File | Action |
|---|---|
| `src/db/reports.ts` | Create |
| `src/agents/generateReport.ts` | Create |
| `tests/unit/reports-db.test.ts` | Create |
| `tests/unit/generateReport.test.ts` | Create |

---

## Task 1: persistence helpers

**Files:** Create `src/db/reports.ts`; Test `tests/unit/reports-db.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/reports-db.test.ts
import { createReport, markFailed, markRunning, markSucceeded } from '@/db/reports';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertReturning = vi.fn();
const insertValues = vi.fn(() => ({ returning: insertReturning }));
const insert = vi.fn(() => ({ values: insertValues }));
const updateWhere = vi.fn();
const updateSet = vi.fn(() => ({ where: updateWhere }));
const update = vi.fn(() => ({ set: updateSet }));
vi.mock('@/db/client-worker', () => ({ workerDb: { insert, update } }));

beforeEach(() => {
  insertReturning.mockReset().mockResolvedValue([{ id: 'rid-1' }]);
  insertValues.mockClear();
  insert.mockClear();
  updateWhere.mockReset().mockResolvedValue(undefined);
  updateSet.mockClear();
  update.mockClear();
});

describe('reports persistence', () => {
  it('createReport inserts a queued row and returns its id', async () => {
    const id = await createReport('user-1');
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', status: 'queued' }));
    expect(id).toBe('rid-1');
  });

  it('createReport throws when no row is returned', async () => {
    insertReturning.mockResolvedValue([]);
    await expect(createReport('user-1')).rejects.toThrow();
  });

  it('markRunning sets status running', async () => {
    await markRunning('rid-1');
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }));
    expect(updateWhere).toHaveBeenCalledOnce();
  });

  it('markSucceeded sets status + pdfUrl + subjectAddress + completedAt', async () => {
    await markSucceeded('rid-1', { pdfUrl: 'reports/rid-1/v1.pdf', subjectAddress: '12 X St' });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded', pdfUrl: 'reports/rid-1/v1.pdf', subjectAddress: '12 X St' }),
    );
  });

  it('markFailed sets status failed + errorMessage', async () => {
    await markFailed('rid-1', 'boom');
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', errorMessage: 'boom' }));
  });
});
```

- [ ] **Step 2: Run → fail** — `pnpm vitest run tests/unit/reports-db.test.ts` — Expected: `Cannot find module '@/db/reports'`.

- [ ] **Step 3: Create `src/db/reports.ts`**

```ts
// src/db/reports.ts — report row lifecycle (CLAUDE.md §4.2). Runs in the worker
// context (alongside the graph + llm_calls writes), so it uses the session-mode
// workerDb pool.

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
  await workerDb
    .update(reports)
    .set({ status: 'running', updatedAt: new Date() })
    .where(eq(reports.id, id));
}

export interface ReportSuccess {
  pdfUrl: string;
  subjectAddress: string | null;
}

export async function markSucceeded(id: string, r: ReportSuccess): Promise<void> {
  await workerDb
    .update(reports)
    .set({
      status: 'succeeded',
      pdfUrl: r.pdfUrl,
      subjectAddress: r.subjectAddress,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reports.id, id));
}

export async function markFailed(id: string, errorMessage: string): Promise<void> {
  await workerDb
    .update(reports)
    .set({ status: 'failed', errorMessage, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(reports.id, id));
}
```

- [ ] **Step 4: Run → pass + gate** — `pnpm exec biome check --write src/db/reports.ts tests/unit/reports-db.test.ts` then `pnpm vitest run tests/unit/reports-db.test.ts` then `pnpm typecheck && pnpm lint && pnpm test`. Expected: all PASS.

- [ ] **Step 5: Commit** — `git add src/db/reports.ts tests/unit/reports-db.test.ts && git commit -m "feat: report row persistence helpers (create/running/succeeded/failed)"`

---

## Task 2: `generateReport` orchestrator

**Files:** Create `src/agents/generateReport.ts`; Test `tests/unit/generateReport.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/generateReport.test.ts
import { generateReport } from '@/agents/generateReport';
import { runGraph } from '@/agents/graph';
import { createReport, markFailed, markRunning, markSucceeded } from '@/db/reports';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db/reports', () => ({
  createReport: vi.fn(),
  markRunning: vi.fn(),
  markSucceeded: vi.fn(),
  markFailed: vi.fn(),
}));
vi.mock('@/agents/graph', () => ({ runGraph: vi.fn() }));
vi.mock('@/agents/subject', () => ({ buildSubject: vi.fn((x: unknown) => x) }));

const mockCreate = vi.mocked(createReport);
const mockRun = vi.mocked(runGraph);

const input = { userId: 'u1', rawAddress: '12 Awaba St, Mosman NSW 2088', rawSubject: { attrs: {} } };

beforeEach(() => {
  vi.mocked(createReport).mockReset().mockResolvedValue('rid-1');
  vi.mocked(markRunning).mockReset().mockResolvedValue(undefined);
  vi.mocked(markSucceeded).mockReset().mockResolvedValue(undefined);
  vi.mocked(markFailed).mockReset().mockResolvedValue(undefined);
  mockRun.mockReset();
});

describe('generateReport', () => {
  it('creates → runs → marks succeeded on a state with a pdfUrl', async () => {
    mockRun.mockResolvedValue({ pdfUrl: 'reports/rid-1/v1.pdf', resolvedAddress: { normalizedAddress: '12 Awaba St, Mosman NSW 2088' } } as never);
    const id = await generateReport(input);
    expect(id).toBe('rid-1');
    expect(mockCreate).toHaveBeenCalledWith('u1');
    expect(vi.mocked(markRunning)).toHaveBeenCalledWith('rid-1');
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ reportId: 'rid-1', rawAddress: input.rawAddress }));
    expect(vi.mocked(markSucceeded)).toHaveBeenCalledWith('rid-1', { pdfUrl: 'reports/rid-1/v1.pdf', subjectAddress: '12 Awaba St, Mosman NSW 2088' });
    expect(vi.mocked(markFailed)).not.toHaveBeenCalled();
  });

  it('marks failed when the graph throws', async () => {
    mockRun.mockRejectedValue(new Error('boom'));
    const id = await generateReport(input);
    expect(id).toBe('rid-1');
    expect(vi.mocked(markFailed)).toHaveBeenCalledWith('rid-1', 'boom');
    expect(vi.mocked(markSucceeded)).not.toHaveBeenCalled();
  });

  it('marks failed when no pdfUrl was produced', async () => {
    mockRun.mockResolvedValue({ pdfUrl: null, resolvedAddress: null } as never);
    await generateReport(input);
    expect(vi.mocked(markFailed)).toHaveBeenCalledWith('rid-1', 'render produced no PDF');
  });
});
```

- [ ] **Step 2: Run → fail** — `pnpm vitest run tests/unit/generateReport.test.ts` — Expected: `Cannot find module '@/agents/generateReport'`.

- [ ] **Step 3: Create `src/agents/generateReport.ts`**

```ts
// src/agents/generateReport.ts — orchestrate one report: create the row, run the
// graph, persist the outcome. The body of the future Inngest function.

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

- [ ] **Step 4: Run → pass + gate** — `pnpm exec biome check --write src/agents/generateReport.ts tests/unit/generateReport.test.ts` then `pnpm vitest run tests/unit/generateReport.test.ts` then `pnpm typecheck && pnpm lint && pnpm test`. Expected: all PASS.

- [ ] **Step 5: Commit** — `git add src/agents/generateReport.ts tests/unit/generateReport.test.ts && git commit -m "feat: generateReport orchestrator (create -> run graph -> persist)"`

---

## Self-review (done while writing)

- **Spec coverage:** §2 persistence → Task 1. §3 orchestrator → Task 2. §4 tests → both.
- **Placeholder scan:** none — full code in every step.
- **Type consistency:** `createReport(userId): Promise<string>`, `markSucceeded(id, {pdfUrl, subjectAddress})` consumed by the orchestrator; orchestrator returns the created id; `runGraph` mock returns the `{pdfUrl, resolvedAddress}` the orchestrator reads. Tests mock `@/db/reports` (orchestrator) vs `@/db/client-worker` (persistence) so each layer is isolated.

## Done criteria

- `src/db/reports.ts` + `src/agents/generateReport.ts` implemented; both unit-tested (graph + db mocked); `pnpm typecheck && pnpm lint && pnpm test` green; `CLAUDE.md` untouched; no new deps/creds.
