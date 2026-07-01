// tests/unit/api-reports.test.ts
//
// Unit tests for the report trigger + status API routes:
//   POST /api/reports   → src/app/api/reports/route.ts
//   GET  /api/reports/[id] → src/app/api/reports/[id]/route.ts
//
// All external dependencies are mocked:
//   @/lib/auth/user     — requireAllowedUser → { userId: 'u1', email: 'a@b.com' }
//   @/db/reports        — createReport, getReportStatus
//   @/inngest/client    — inngest.send

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock @/lib/auth/user ────────────────────────────────────────────────────

vi.mock('@/lib/auth/user', () => ({
  requireAllowedUser: vi.fn().mockResolvedValue({ userId: 'u1', email: 'a@b.com' }),
}));

// ── Mock @/db/reports ───────────────────────────────────────────────────────

vi.mock('@/db/reports', () => ({
  createReport: vi.fn(),
  getReportStatus: vi.fn(),
  // Other exports consumed by other modules; provide stubs so any accidental
  // import doesn't blow up.
  markRunning: vi.fn(),
  markSucceeded: vi.fn(),
  markFailed: vi.fn(),
  markNode: vi.fn(),
}));

// ── Mock @/inngest/client ───────────────────────────────────────────────────

vi.mock('@/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

// ── Mock @/db/client and @/db/client-worker (pulled in transitively) ────────
// The route and helper modules import these at module level; without a mock
// they would try to connect to Postgres.

vi.mock('@/db/client', () => ({ db: {} }));
vi.mock('@/db/client-worker', () => ({ workerDb: {} }));

// ── Mock @/db/rate-limit ────────────────────────────────────────────────────

vi.mock('@/db/rate-limit', () => ({
  DAILY_REPORT_LIMIT: 20,
  bumpDailyReportCount: vi.fn(),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import { GET } from '@/app/api/reports/[id]/route';
import { POST } from '@/app/api/reports/route';
import { bumpDailyReportCount } from '@/db/rate-limit';
import { createReport, getReportStatus, markFailed } from '@/db/reports';
import { inngest } from '@/inngest/client';
import { NODE_ORDER } from '@/lib/reportNodes';

const mockCreateReport = vi.mocked(createReport);
const mockGetReportStatus = vi.mocked(getReportStatus);
const mockMarkFailed = vi.mocked(markFailed);
const mockSend = vi.mocked(inngest.send);
const mockBump = vi.mocked(bumpDailyReportCount);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePostRequest(body: unknown): Request {
  return new Request('http://localhost/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeGetParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const VALID_BODY = {
  rawAddress: '12 Awaba St, Mosman NSW 2088',
  subject: {
    beds: 3,
    baths: 2,
    parking: 1,
    landArea: 450,
    buildingArea: null,
    propertyType: 'House',
  },
};

// ── POST /api/reports ────────────────────────────────────────────────────────

describe('POST /api/reports', () => {
  beforeEach(() => {
    mockCreateReport.mockReset().mockResolvedValue('rid-1');
    mockSend.mockReset().mockResolvedValue(undefined as never);
    mockMarkFailed.mockReset().mockResolvedValue(undefined as never);
    mockBump.mockReset().mockResolvedValue(1); // under the limit by default
  });

  it('returns 201 { id } on a valid body', async () => {
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toEqual({ id: 'rid-1' });
  });

  it('returns 429 without creating/enqueuing when the daily limit is exceeded', async () => {
    mockBump.mockResolvedValueOnce(21); // over the limit of 20
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Daily limit') });
    expect(mockCreateReport).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('calls createReport with the userId from requireAllowedUser', async () => {
    await POST(makePostRequest(VALID_BODY));
    expect(mockCreateReport).toHaveBeenCalledOnce();
    expect(mockCreateReport).toHaveBeenCalledWith('u1');
  });

  it('sends the correct Inngest event', async () => {
    await POST(makePostRequest(VALID_BODY));
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledWith({
      name: 'reports/generate.requested',
      data: {
        reportId: 'rid-1',
        userId: 'u1',
        rawAddress: VALID_BODY.rawAddress,
        rawSubject: { attrs: VALID_BODY.subject, photos: [] },
      },
    });
  });

  it('marks the report failed and returns 502 if inngest.send throws', async () => {
    mockSend.mockRejectedValue(new Error('inngest down'));
    const res = await POST(makePostRequest(VALID_BODY));
    expect(res.status).toBe(502);
    expect(mockCreateReport).toHaveBeenCalledOnce(); // row was created first
    expect(mockMarkFailed).toHaveBeenCalledWith('rid-1', expect.stringContaining('enqueue'));
  });

  it('returns 400 when rawAddress is missing', async () => {
    const res = await POST(makePostRequest({ subject: VALID_BODY.subject }));
    expect(res.status).toBe(400);
    expect(mockCreateReport).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 when subject is malformed', async () => {
    const res = await POST(makePostRequest({ rawAddress: '12 X St', subject: { beds: 'three' } }));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns 400 when body is empty', async () => {
    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does not send if createReport throws', async () => {
    mockCreateReport.mockRejectedValue(new Error('db down'));
    await expect(POST(makePostRequest(VALID_BODY))).rejects.toThrow('db down');
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ── GET /api/reports/[id] ────────────────────────────────────────────────────

describe('GET /api/reports/[id]', () => {
  const BASE_ROW = {
    status: 'running',
    currentNode: 'compose',
    pdfUrl: null,
    errorMessage: null,
    subjectAddress: '12 Awaba St, Mosman NSW 2088',
  };

  beforeEach(() => {
    mockGetReportStatus.mockReset();
  });

  it('returns the status shape', async () => {
    mockGetReportStatus.mockResolvedValue(BASE_ROW);
    const res = await GET(new Request('http://localhost'), makeGetParams('rid-1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      status: 'running',
      currentNode: 'compose',
      pdfUrl: null,
      errorMessage: null,
      subjectAddress: '12 Awaba St, Mosman NSW 2088',
    });
    expect(typeof json.percentage).toBe('number');
  });

  it('returns 404 when getReportStatus returns null (not found / wrong owner)', async () => {
    mockGetReportStatus.mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), makeGetParams('rid-999'));
    expect(res.status).toBe(404);
  });

  it('calls getReportStatus with the correct id and userId', async () => {
    mockGetReportStatus.mockResolvedValue(BASE_ROW);
    await GET(new Request('http://localhost'), makeGetParams('rid-42'));
    expect(mockGetReportStatus).toHaveBeenCalledWith('rid-42', 'u1');
  });

  // ── Percentage computation ────────────────────────────────────────────────

  it('percentage is 100 when status is succeeded', async () => {
    mockGetReportStatus.mockResolvedValue({ ...BASE_ROW, status: 'succeeded', currentNode: null });
    const res = await GET(new Request('http://localhost'), makeGetParams('rid-1'));
    const json = await res.json();
    expect(json.percentage).toBe(100);
  });

  it('percentage is 0 when status is queued', async () => {
    mockGetReportStatus.mockResolvedValue({ ...BASE_ROW, status: 'queued', currentNode: null });
    const res = await GET(new Request('http://localhost'), makeGetParams('rid-1'));
    const json = await res.json();
    expect(json.percentage).toBe(0);
  });

  it('percentage is 0 when currentNode is null', async () => {
    mockGetReportStatus.mockResolvedValue({ ...BASE_ROW, status: 'running', currentNode: null });
    const res = await GET(new Request('http://localhost'), makeGetParams('rid-1'));
    const json = await res.json();
    expect(json.percentage).toBe(0);
  });

  it('percentage for the first node (resolveAddress) tracks the node order', async () => {
    mockGetReportStatus.mockResolvedValue({ ...BASE_ROW, currentNode: 'resolveAddress' });
    const res = await GET(new Request('http://localhost'), makeGetParams('rid-1'));
    const json = await res.json();
    const expected = Math.round(
      ((NODE_ORDER.indexOf('resolveAddress') + 1) / NODE_ORDER.length) * 100,
    );
    expect(json.percentage).toBe(expected);
  });

  it('percentage for render (index 9 = last) is 100', async () => {
    mockGetReportStatus.mockResolvedValue({
      ...BASE_ROW,
      status: 'running',
      currentNode: 'render',
    });
    const res = await GET(new Request('http://localhost'), makeGetParams('rid-1'));
    const json = await res.json();
    expect(json.percentage).toBe(100);
  });

  it('percentage for a late node (compose) tracks the node order', async () => {
    mockGetReportStatus.mockResolvedValue({ ...BASE_ROW, currentNode: 'compose' });
    const res = await GET(new Request('http://localhost'), makeGetParams('rid-1'));
    const json = await res.json();
    const expected = Math.round(((NODE_ORDER.indexOf('compose') + 1) / NODE_ORDER.length) * 100);
    expect(json.percentage).toBe(expected);
  });

  it('percentage is 0 for an unknown currentNode', async () => {
    mockGetReportStatus.mockResolvedValue({ ...BASE_ROW, currentNode: 'unknownNode' });
    const res = await GET(new Request('http://localhost'), makeGetParams('rid-1'));
    const json = await res.json();
    expect(json.percentage).toBe(0);
  });
});
