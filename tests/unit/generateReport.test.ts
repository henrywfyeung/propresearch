// tests/unit/generateReport.test.ts
import { generateReport, runReport } from '@/agents/generateReport';
import { runGraph } from '@/agents/graph';
import { createReport, markFailed, markNode, markRunning, markSucceeded } from '@/db/reports';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db/reports', () => ({
  createReport: vi.fn(),
  markRunning: vi.fn(),
  markSucceeded: vi.fn(),
  markFailed: vi.fn(),
  markNode: vi.fn(),
}));
vi.mock('@/agents/graph', () => ({ runGraph: vi.fn() }));
vi.mock('@/agents/subject', () => ({ buildSubject: vi.fn((x: unknown) => x) }));

const mockCreate = vi.mocked(createReport);
const mockRun = vi.mocked(runGraph);
const mockMarkNode = vi.mocked(markNode);

const rawInput = {
  rawAddress: '12 Awaba St, Mosman NSW 2088',
  rawSubject: { attrs: {} },
};

const generateInput = { userId: 'u1', ...rawInput };

beforeEach(() => {
  vi.mocked(createReport).mockReset().mockResolvedValue('rid-1');
  vi.mocked(markRunning).mockReset().mockResolvedValue(undefined);
  vi.mocked(markSucceeded).mockReset().mockResolvedValue(undefined);
  vi.mocked(markFailed).mockReset().mockResolvedValue(undefined);
  vi.mocked(markNode).mockReset().mockResolvedValue(undefined);
  mockRun.mockReset();
});

// ── runReport ──────────────────────────────────────────────────────────────────

describe('runReport', () => {
  it('marks running → calls runGraph with onNode → marks succeeded on pdfUrl', async () => {
    mockRun.mockResolvedValue({
      pdfUrl: 'reports/rid-1/v1.pdf',
      resolvedAddress: { normalizedAddress: '12 Awaba St, Mosman NSW 2088' },
    } as never);

    await runReport('rid-1', rawInput);

    expect(vi.mocked(markRunning)).toHaveBeenCalledWith('rid-1');
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'rid-1', rawAddress: rawInput.rawAddress }),
      expect.objectContaining({ onNode: expect.any(Function) }),
    );
    expect(vi.mocked(markSucceeded)).toHaveBeenCalledWith('rid-1', {
      pdfUrl: 'reports/rid-1/v1.pdf',
      subjectAddress: '12 Awaba St, Mosman NSW 2088',
    });
    expect(vi.mocked(markFailed)).not.toHaveBeenCalled();
  });

  it('the onNode callback passed to runGraph calls markNode', async () => {
    mockRun.mockImplementation(async (_input, opts) => {
      // simulate the graph calling onNode for two nodes
      await opts?.onNode?.('resolveAddress');
      await opts?.onNode?.('compose');
      return {
        pdfUrl: 'reports/rid-1/v1.pdf',
        resolvedAddress: { normalizedAddress: '12 Awaba St, Mosman NSW 2088' },
      } as never;
    });

    await runReport('rid-1', rawInput);

    expect(mockMarkNode).toHaveBeenCalledWith('rid-1', 'resolveAddress');
    expect(mockMarkNode).toHaveBeenCalledWith('rid-1', 'compose');
    expect(mockMarkNode).toHaveBeenCalledTimes(2);
  });

  it('marks failed when the graph throws', async () => {
    mockRun.mockRejectedValue(new Error('boom'));
    await runReport('rid-1', rawInput);
    expect(vi.mocked(markFailed)).toHaveBeenCalledWith('rid-1', 'boom');
    expect(vi.mocked(markSucceeded)).not.toHaveBeenCalled();
  });

  it('marks failed when no pdfUrl was produced', async () => {
    mockRun.mockResolvedValue({ pdfUrl: null, resolvedAddress: null } as never);
    await runReport('rid-1', rawInput);
    expect(vi.mocked(markFailed)).toHaveBeenCalledWith('rid-1', 'render produced no PDF');
    expect(vi.mocked(markSucceeded)).not.toHaveBeenCalled();
  });
});

// ── generateReport (thin wrapper) ────────────────────────────────────────────

describe('generateReport', () => {
  it('creates → runs → marks succeeded on a state with a pdfUrl', async () => {
    mockRun.mockResolvedValue({
      pdfUrl: 'reports/rid-1/v1.pdf',
      resolvedAddress: { normalizedAddress: '12 Awaba St, Mosman NSW 2088' },
    } as never);
    const id = await generateReport(generateInput);
    expect(id).toBe('rid-1');
    expect(mockCreate).toHaveBeenCalledWith('u1');
    expect(vi.mocked(markRunning)).toHaveBeenCalledWith('rid-1');
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'rid-1', rawAddress: generateInput.rawAddress }),
      expect.objectContaining({ onNode: expect.any(Function) }),
    );
    expect(vi.mocked(markSucceeded)).toHaveBeenCalledWith('rid-1', {
      pdfUrl: 'reports/rid-1/v1.pdf',
      subjectAddress: '12 Awaba St, Mosman NSW 2088',
    });
    expect(vi.mocked(markFailed)).not.toHaveBeenCalled();
  });

  it('marks failed when the graph throws', async () => {
    mockRun.mockRejectedValue(new Error('boom'));
    const id = await generateReport(generateInput);
    expect(id).toBe('rid-1');
    expect(vi.mocked(markFailed)).toHaveBeenCalledWith('rid-1', 'boom');
    expect(vi.mocked(markSucceeded)).not.toHaveBeenCalled();
  });

  it('marks failed when no pdfUrl was produced', async () => {
    mockRun.mockResolvedValue({ pdfUrl: null, resolvedAddress: null } as never);
    await generateReport(generateInput);
    expect(vi.mocked(markFailed)).toHaveBeenCalledWith('rid-1', 'render produced no PDF');
  });
});
