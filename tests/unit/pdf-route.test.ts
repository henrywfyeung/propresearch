// tests/unit/pdf-route.test.ts
import { Readable } from 'node:stream';
import { GET } from '@/app/reports/[id]/pdf/route';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/user', () => ({
  requireAllowedUser: vi.fn(),
}));

vi.mock('@/db/reports', () => ({
  getReportStatus: vi.fn(),
}));

vi.mock('@/tools/storage/gcs', () => ({
  getPdfStream: vi.fn(),
}));

// We also need to mock next/navigation (redirect used inside requireAllowedUser
// in the real impl; mocked here, so it's a no-op — the mock returns directly).
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { getReportStatus } from '@/db/reports';
import { requireAllowedUser } from '@/lib/auth/user';
import { getPdfStream } from '@/tools/storage/gcs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const PDF_BYTES = new Uint8Array([37, 80, 68, 70]); // %PDF

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAllowedUser).mockResolvedValue({ userId: 'user-1', email: 'a@b.com' });
  vi.mocked(getReportStatus).mockResolvedValue({
    status: 'succeeded',
    currentNode: null,
    pdfUrl: 'reports/report-abc/v1.pdf',
    errorMessage: null,
    subjectAddress: '1 Test St',
  });
  vi.mocked(getPdfStream).mockResolvedValue({
    stream: Readable.from(Buffer.from(PDF_BYTES)),
    size: PDF_BYTES.byteLength,
  });
});

// ---------------------------------------------------------------------------
// Tests — PDF route
// ---------------------------------------------------------------------------

describe('GET /reports/[id]/pdf', () => {
  it('returns 200 with correct headers and body for an owned, ready report', async () => {
    const res = await GET(new Request('http://localhost'), makeParams('report-abc'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="report-report-abc.pdf"',
    );
    expect(res.headers.get('Content-Length')).toBe(String(PDF_BYTES.byteLength));

    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(PDF_BYTES);
  });

  it('calls getPdfStream with the report pdfUrl key', async () => {
    await GET(new Request('http://localhost'), makeParams('report-abc'));
    expect(getPdfStream).toHaveBeenCalledWith('reports/report-abc/v1.pdf');
  });

  it('returns 404 and does NOT call getPdfStream when getReportStatus returns null', async () => {
    vi.mocked(getReportStatus).mockResolvedValue(null);

    const res = await GET(new Request('http://localhost'), makeParams('missing'));

    expect(res.status).toBe(404);
    expect(getPdfStream).not.toHaveBeenCalled();
  });

  it('returns 404 when report exists but pdfUrl is null (PDF not ready)', async () => {
    vi.mocked(getReportStatus).mockResolvedValue({
      status: 'running',
      currentNode: 'compose',
      pdfUrl: null,
      errorMessage: null,
      subjectAddress: null,
    });

    const res = await GET(new Request('http://localhost'), makeParams('report-abc'));

    expect(res.status).toBe(404);
    expect(getPdfStream).not.toHaveBeenCalled();
  });

  it('passes the awaited id to getReportStatus', async () => {
    await GET(new Request('http://localhost'), makeParams('report-xyz'));
    expect(getReportStatus).toHaveBeenCalledWith('report-xyz', 'user-1');
  });
});

// ---------------------------------------------------------------------------
// Tests — the route's contract with the storage layer
// ---------------------------------------------------------------------------

describe('storage contract', () => {
  it('streams whatever bytes getPdfStream yields', async () => {
    // The storage module itself is covered by storage-gcs.test.ts. Here we
    // only verify the route forwards the stream through unmodified.
    vi.mocked(getPdfStream).mockResolvedValueOnce({
      stream: Readable.from(Buffer.from(new Uint8Array([1, 2, 3]))),
      size: 3,
    });

    const res = await GET(new Request('http://localhost'), makeParams('report-abc'));
    const body = new Uint8Array(await res.arrayBuffer());

    expect(body).toEqual(new Uint8Array([1, 2, 3]));
  });
});
