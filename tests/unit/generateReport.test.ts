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

const input = {
  userId: 'u1',
  rawAddress: '12 Awaba St, Mosman NSW 2088',
  rawSubject: { attrs: {} },
};

beforeEach(() => {
  vi.mocked(createReport).mockReset().mockResolvedValue('rid-1');
  vi.mocked(markRunning).mockReset().mockResolvedValue(undefined);
  vi.mocked(markSucceeded).mockReset().mockResolvedValue(undefined);
  vi.mocked(markFailed).mockReset().mockResolvedValue(undefined);
  mockRun.mockReset();
});

describe('generateReport', () => {
  it('creates → runs → marks succeeded on a state with a pdfUrl', async () => {
    mockRun.mockResolvedValue({
      pdfUrl: 'reports/rid-1/v1.pdf',
      resolvedAddress: { normalizedAddress: '12 Awaba St, Mosman NSW 2088' },
    } as never);
    const id = await generateReport(input);
    expect(id).toBe('rid-1');
    expect(mockCreate).toHaveBeenCalledWith('u1');
    expect(vi.mocked(markRunning)).toHaveBeenCalledWith('rid-1');
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ reportId: 'rid-1', rawAddress: input.rawAddress }),
    );
    expect(vi.mocked(markSucceeded)).toHaveBeenCalledWith('rid-1', {
      pdfUrl: 'reports/rid-1/v1.pdf',
      subjectAddress: '12 Awaba St, Mosman NSW 2088',
    });
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
