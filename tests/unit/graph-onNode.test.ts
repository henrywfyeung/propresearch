// tests/unit/graph-onNode.test.ts — unit-tests for the runGraph onNode callback.
// Stubs reportGraph.stream/invoke so the test doesn't need HTTP mocks or real
// DB connections.  The same module-level vi.mock calls that graph.test.ts uses
// are needed here because importing @/agents/graph transitively loads the node
// implementations → @/tools/llm/structuredCall → @/db/client-worker (which
// throws at load time without WORKER_DATABASE_URL).

import type { GraphState } from '@/agents/annotation';
import * as graphModule from '@/agents/graph';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks before any real module code runs.
vi.mock('@/tools/llm/structuredCall', () => ({ callWithFallback: vi.fn() }));
vi.mock('@/agents/nodes/09_fetchRisks', () => ({
  fetchRisks: vi.fn().mockResolvedValue({ risks: [] }),
}));
vi.mock('@/agents/nodes/05_planningAndNews', () => ({
  fetchPlanning: vi.fn().mockResolvedValue({ market: null }),
}));
vi.mock('@/report/pdf', () => ({
  renderReportPdf: vi.fn().mockResolvedValue(new Uint8Array([1])),
}));
vi.mock('@/tools/storage/s3', () => ({
  uploadPdf: vi.fn().mockResolvedValue('reports/r-test/v1.pdf'),
}));

const fakeState: Partial<GraphState> = {
  reportId: 'r-test',
  rawAddress: '1 Test St',
  resolvedAddress: null,
  comparables: [],
  risks: [],
  prose: {},
  errors: [],
  pdfUrl: 'reports/r-test/v1.pdf',
};

// Multi-mode stream: yields [mode, payload] tuples.
// updates come first (node completions), then values (full state) at the end.
async function* fakeStream() {
  yield ['updates', { resolveAddress: {} }];
  yield ['updates', { compose: {} }];
  yield ['values', fakeState];
}

// biome-ignore lint/suspicious/noExplicitAny: spy type varies by LangGraph version
let streamSpy: ReturnType<typeof vi.spyOn<any, any>>;

beforeEach(() => {
  streamSpy = vi.spyOn(graphModule.reportGraph, 'stream').mockResolvedValue(fakeStream() as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runGraph onNode callback', () => {
  it('calls onNode for each completed node', async () => {
    const nodes: string[] = [];
    await graphModule.runGraph(
      { reportId: 'r-test', rawAddress: '1 Test St' },
      {
        onNode: (n) => {
          nodes.push(n);
        },
      },
    );
    expect(nodes).toEqual(['resolveAddress', 'compose']);
  });

  it('returns the final aggregated state (last values chunk)', async () => {
    const state = await graphModule.runGraph(
      { reportId: 'r-test', rawAddress: '1 Test St' },
      {
        onNode: vi.fn(),
      },
    );
    expect(state.pdfUrl).toBe('reports/r-test/v1.pdf');
    expect(state.errors).toEqual([]);
  });

  it('awaits an async onNode callback before continuing', async () => {
    const order: string[] = [];
    await graphModule.runGraph(
      { reportId: 'r-test', rawAddress: '1 Test St' },
      {
        onNode: async (n) => {
          await Promise.resolve();
          order.push(n);
        },
      },
    );
    expect(order).toEqual(['resolveAddress', 'compose']);
  });

  it('omitting onNode uses the fast invoke path (stream is NOT called)', async () => {
    const invokeSpy = vi
      .spyOn(graphModule.reportGraph, 'invoke')
      .mockResolvedValue(fakeState as never);

    await graphModule.runGraph({ reportId: 'r-test', rawAddress: '1 Test St' });

    expect(invokeSpy).toHaveBeenCalledOnce();
    expect(streamSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('throws if the stream produces no values chunk', async () => {
    async function* emptyStream() {
      yield ['updates', { resolveAddress: {} }];
      // no 'values' chunk
    }
    vi.spyOn(graphModule.reportGraph, 'stream').mockResolvedValue(emptyStream() as never);

    await expect(
      graphModule.runGraph({ reportId: 'r-test', rawAddress: '1 Test St' }, { onNode: vi.fn() }),
    ).rejects.toThrow('no final state');
  });
});
