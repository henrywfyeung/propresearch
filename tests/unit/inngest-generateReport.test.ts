// tests/unit/inngest-generateReport.test.ts
//
// 1. Handler logic test: invoke `runReportHandler` directly (bypasses Inngest
//    internals), mock `@/agents/generateReport`, assert `runReport` is called
//    with the correct args and the return value is `{ reportId }`.
//
// 2. Route smoke test: import `src/app/api/inngest/route.ts` and assert that
//    GET / POST / PUT are exported as functions.  Mocks client + function
//    module so no network or DB is touched.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock @/agents/generateReport before importing the handler ─────────────────

vi.mock('@/agents/generateReport', () => ({
  runReport: vi.fn(),
}));

// ── Mock inngest client + serve so the route module loads without real creds ──
// (The mock must be declared before the dynamic import of the route.)

vi.mock('@/inngest/client', () => ({
  inngest: {
    createFunction: vi.fn((_cfg: unknown, _trigger: unknown, handler: unknown) => ({
      _handler: handler,
    })),
    send: vi.fn(),
    id: 'propresearch',
  },
}));

// The route imports from 'inngest/next'; mock serve() to return plain fns.
vi.mock('inngest/next', () => ({
  serve: vi.fn(() => ({
    GET: vi.fn(),
    POST: vi.fn(),
    PUT: vi.fn(),
  })),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { runReport } from '@/agents/generateReport';
import { runReportHandler } from '@/inngest/functions/generateReport';

const mockRunReport = vi.mocked(runReport);

// ── Helper: build a minimal fake `step` ───────────────────────────────────────

type FakeStep = Parameters<typeof runReportHandler>[0]['step'];

function makeStep(): { step: FakeStep; runSpy: ReturnType<typeof vi.fn> } {
  // vi.fn can't express the generic overload; we build a spy that executes the
  // thunk and cast the whole step object once.
  const runSpy = vi.fn((id: string, fn: () => unknown): Promise<unknown> => {
    void id;
    return Promise.resolve(fn());
  });
  return { step: { run: runSpy } as unknown as FakeStep, runSpy };
}

// ── 1. Handler logic ──────────────────────────────────────────────────────────

describe('runReportHandler', () => {
  const EVENT_DATA = {
    reportId: 'rid-42',
    userId: 'uid-1',
    rawAddress: '12 Awaba St, Mosman NSW 2088',
    rawSubject: { attrs: { beds: 3 } },
  };

  beforeEach(() => {
    mockRunReport.mockReset().mockResolvedValue(undefined);
  });

  it('calls runReport with reportId + RunReportInput from event.data', async () => {
    const { step } = makeStep();
    const result = await runReportHandler({ event: { data: EVENT_DATA }, step });

    expect(mockRunReport).toHaveBeenCalledOnce();
    expect(mockRunReport).toHaveBeenCalledWith('rid-42', {
      rawAddress: EVENT_DATA.rawAddress,
      rawSubject: EVENT_DATA.rawSubject,
    });
    expect(result).toEqual({ reportId: 'rid-42' });
  });

  it('returns { reportId } matching event.data.reportId', async () => {
    const { step } = makeStep();
    const result = await runReportHandler({
      event: { data: { ...EVENT_DATA, reportId: 'rid-99' } },
      step,
    });
    expect(result).toEqual({ reportId: 'rid-99' });
  });

  it('wraps runReport inside step.run("run-report", …)', async () => {
    const { step, runSpy } = makeStep();
    await runReportHandler({ event: { data: EVENT_DATA }, step });

    expect(runSpy).toHaveBeenCalledOnce();
    expect(runSpy).toHaveBeenCalledWith('run-report', expect.any(Function));
  });

  it('propagates runReport errors up through the step', async () => {
    mockRunReport.mockRejectedValue(new Error('graph exploded'));
    const { step } = makeStep();
    await expect(runReportHandler({ event: { data: EVENT_DATA }, step })).rejects.toThrow(
      'graph exploded',
    );
  });
});

// ── 2. Route smoke test ───────────────────────────────────────────────────────

describe('src/app/api/inngest/route.ts exports', () => {
  it('exports GET, POST, PUT as functions', async () => {
    // Dynamic import so module-level mocks above are already in place.
    const route = await import('@/app/api/inngest/route');
    expect(typeof route.GET).toBe('function');
    expect(typeof route.POST).toBe('function');
    expect(typeof route.PUT).toBe('function');
  });
});
