// src/app/api/reports/[id]/route.ts — GET /api/reports/[id]
//
// Returns the live status of a report for the progress-polling UI.
// Only top-level denormalised columns are read — no state JSONB access
// (satisfies the §4.3 cross-row ESLint guard). Ownership is enforced
// inside getReportStatus (by-id AND by-userId predicate); no match → 404.

export const runtime = 'nodejs';

import { getReportStatus } from '@/db/reports';
import { requireAllowedUser } from '@/lib/auth/user';
// Node order for the percentage approximation lives in a shared module so it
// can't drift from the client stepper (§15.2). Order is approximate — many
// nodes run concurrently; its only job is to drive the progress bar.
import { NODE_ORDER } from '@/lib/reportNodes';

function computePercentage(status: string, currentNode: string | null): number {
  if (status === 'succeeded') return 100;
  if (status === 'queued' || !currentNode) return 0;
  const idx = NODE_ORDER.indexOf(currentNode as (typeof NODE_ORDER)[number]);
  if (idx === -1) return 0;
  const pct = Math.round(((idx + 1) / NODE_ORDER.length) * 100);
  return Math.max(0, Math.min(100, pct));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { userId } = await requireAllowedUser();
  const { id } = await params;

  const row = await getReportStatus(id, userId);
  if (!row) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  const percentage = computePercentage(row.status, row.currentNode);

  return Response.json({
    status: row.status,
    currentNode: row.currentNode,
    percentage,
    pdfUrl: row.pdfUrl,
    errorMessage: row.errorMessage,
    subjectAddress: row.subjectAddress,
  });
}
