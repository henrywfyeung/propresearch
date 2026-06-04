import { render } from '@/agents/nodes/13_render';
import { fetchImagesAsDataUrls } from '@/report/fetchImages';
import { renderReportPdf } from '@/report/pdf';
import { uploadPdf } from '@/tools/storage/s3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// tests/unit/render.test.ts
import { graphState, sampleComparable } from '../fixtures/comps';

vi.mock('@/report/pdf', () => ({ renderReportPdf: vi.fn() }));
vi.mock('@/tools/storage/s3', () => ({ uploadPdf: vi.fn() }));
vi.mock('@/report/fetchImages', () => ({ fetchImagesAsDataUrls: vi.fn() }));
const mockPdf = vi.mocked(renderReportPdf);
const mockUpload = vi.mocked(uploadPdf);
const mockFetchImages = vi.mocked(fetchImagesAsDataUrls);

const tri = {
  compDerived: 2_500_000,
  low: 2_400_000,
  high: 2_600_000,
  reconciled: 2_500_000,
  confidence: 'high' as const,
  spread: 0.08,
  compIds: ['a'],
  bands: null,
  uncertaintyNote: null,
  narrative: 'Derived from the fair-value comparables in the suburb here.',
};

beforeEach(() => {
  mockPdf.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockUpload.mockReset().mockResolvedValue('reports/r1/v1.pdf');
  // fetchImagesAsDataUrls returns empty by default; override per-test as needed.
  mockFetchImages.mockReset().mockResolvedValue([]);
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

  it('calls fetchImagesAsDataUrls for photos (cap 6) and floorplans (cap 2)', async () => {
    const subjectWithMedia = {
      ...graphState().subject!,
      photos: ['https://cdn.example.com/photo1.jpg', 'https://cdn.example.com/photo2.jpg'],
      floorplans: ['https://cdn.example.com/fp1.jpg'],
    };
    const state = graphState({
      subject: subjectWithMedia,
      prose: { summary: [{ type: 'text', text: 'hi' }] },
    });

    mockFetchImages
      .mockResolvedValueOnce(['data:image/jpeg;base64,ph1=', 'data:image/jpeg;base64,ph2='])
      .mockResolvedValueOnce(['data:image/jpeg;base64,fp1=']);

    await render(state);

    // First call: photos with cap 6
    expect(mockFetchImages).toHaveBeenCalledWith(
      ['https://cdn.example.com/photo1.jpg', 'https://cdn.example.com/photo2.jpg'],
      6,
    );
    // Second call: floorplans with cap 2
    expect(mockFetchImages).toHaveBeenCalledWith(['https://cdn.example.com/fp1.jpg'], 2);
  });

  it('passes base64 data URLs from fetchImagesAsDataUrls into the rendered HTML', async () => {
    const subjectWithPhotos = {
      ...graphState().subject!,
      photos: ['https://cdn.example.com/photo1.jpg'],
      floorplans: ['https://cdn.example.com/fp1.jpg'],
    };
    const state = graphState({
      subject: subjectWithPhotos,
      prose: { summary: [{ type: 'text', text: 'hi' }] },
    });

    const photoDataUrl = 'data:image/jpeg;base64,PHOTO==';
    const fpDataUrl = 'data:image/jpeg;base64,FLOORPLAN==';
    mockFetchImages.mockResolvedValueOnce([photoDataUrl]).mockResolvedValueOnce([fpDataUrl]);

    await render(state);

    const html = mockPdf.mock.calls[0]?.[0] as string;
    expect(html).toContain(photoDataUrl);
    expect(html).toContain(fpDataUrl);
    // Original CDN URLs must NOT appear in the rendered HTML
    expect(html).not.toContain('https://cdn.example.com');
  });

  it('errors in-band when subject/address is missing (no render/upload)', async () => {
    const out = await render(graphState({ subject: null }));
    expect(out.errors?.[0]?.code).toBe('PARTIAL_DATA');
    expect(mockPdf).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
