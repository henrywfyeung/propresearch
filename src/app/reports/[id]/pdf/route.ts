// src/app/reports/[id]/pdf/route.ts — proxied PDF download (CLAUDE.md §7.15).
//
// Authenticates the request, loads the object key from the reports row, fetches
// the object server-side, and streams the bytes back. The key never leaves the
// server and no public or signed URL exists — no browser history / referrer
// leakage.

export const runtime = 'nodejs';

import { Readable } from 'node:stream';
import { getReportStatus } from '@/db/reports';
import { requireAllowedUser } from '@/lib/auth/user';
import { getPdfStream } from '@/tools/storage/gcs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { userId } = await requireAllowedUser();
  const { id } = await params;

  const report = await getReportStatus(id, userId);

  // Ownership check + existence check share the same 404 response so no info
  // is leaked about reports belonging to other users.
  if (!report) {
    return new Response(null, { status: 404 });
  }

  if (!report.pdfUrl) {
    return new Response(null, { status: 404 });
  }

  // Streamed rather than buffered: a 6-10 page report with embedded charts and
  // Street View imagery is several MB, and buffering it held that in the
  // request's heap for the whole download.
  const { stream, size } = await getPdfStream(report.pdfUrl);

  return new Response(Readable.toWeb(Readable.from(stream)) as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="report-${id}.pdf"`,
      'Content-Length': String(size),
    },
  });
}
