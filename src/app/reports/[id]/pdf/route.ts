// src/app/reports/[id]/pdf/route.ts — proxied PDF download (CLAUDE.md §7.15).
//
// Authenticates the request, loads the S3 key from the reports row, fetches
// the object server-side, and streams the bytes back. The S3 key (or any
// signed URL) never leaves the server — no browser history / referrer leakage.

export const runtime = 'nodejs';

import { getReportStatus } from '@/db/reports';
import { requireAllowedUser } from '@/lib/auth/user';
import { getPdf } from '@/tools/storage/s3';

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

  const bytes = await getPdf(report.pdfUrl);

  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="report-${id}.pdf"`,
      'Content-Length': String(bytes.byteLength),
    },
  });
}
