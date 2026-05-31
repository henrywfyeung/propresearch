import { render } from '@/agents/nodes/13_render';
import { renderReportPdf } from '@/report/pdf';
import { uploadPdf } from '@/tools/storage/s3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// tests/unit/render.test.ts
import { graphState, sampleComparable } from '../fixtures/comps';

vi.mock('@/report/pdf', () => ({ renderReportPdf: vi.fn() }));
vi.mock('@/tools/storage/s3', () => ({ uploadPdf: vi.fn() }));
const mockPdf = vi.mocked(renderReportPdf);
const mockUpload = vi.mocked(uploadPdf);

const tri = {
  compDerived: 2_500_000,
  low: 2_400_000,
  high: 2_600_000,
  reconciled: 2_500_000,
  confidence: 'high' as const,
  spread: 0.08,
  compIds: ['a'],
  uncertaintyNote: null,
  narrative: 'Derived from the fair-value comparables in the suburb here.',
};

beforeEach(() => {
  mockPdf.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockUpload.mockReset().mockResolvedValue('reports/r1/v1.pdf');
});

describe('render', () => {
  it('renders HTML -> PDF -> upload and sets pdfUrl', async () => {
    const state = graphState({
      triangulation: tri,
      comparables: [sampleComparable('a', { selection: 'fair-value' })],
      prose: { summary: [{ type: 'text', text: 'hi' }] },
    });
    const out = await render(state);
    expect(mockPdf).toHaveBeenCalledWith(expect.stringContaining('<!DOCTYPE html>'));
    expect(mockUpload).toHaveBeenCalledWith('reports/r1/v1.pdf', expect.any(Uint8Array));
    expect(out.pdfUrl).toBe('reports/r1/v1.pdf');
  });

  it('errors in-band when subject/address is missing (no render/upload)', async () => {
    const out = await render(graphState({ subject: null }));
    expect(out.errors?.[0]?.code).toBe('PARTIAL_DATA');
    expect(mockPdf).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
