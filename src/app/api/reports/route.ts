// src/app/api/reports/route.ts — POST /api/reports
//
// Triggers a new report generation:
//   1. Auth gate (requireAllowedUser)
//   2. Zod-validate the request body
//   3. createReport → insert queued row
//   4. inngest.send → enqueue the generation function
//   5. Return 201 { id }

export const runtime = 'nodejs';

import { createReport, markFailed } from '@/db/reports';
import { inngest } from '@/inngest/client';
import { requireAllowedUser } from '@/lib/auth/user';
import { logger } from '@/lib/observability/logger';
import { z } from 'zod';

const BodySchema = z.object({
  rawAddress: z.string().min(1),
  subject: z.object({
    beds: z.number(),
    baths: z.number(),
    parking: z.number(),
    landArea: z.number().nullable(),
    buildingArea: z.number().nullable(),
    propertyType: z.string(),
  }),
});

export async function POST(req: Request): Promise<Response> {
  const { userId } = await requireAllowedUser();

  const body: unknown = await req.json();
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { rawAddress, subject } = parsed.data;

  const reportId = await createReport(userId);

  try {
    await inngest.send({
      name: 'reports/generate.requested',
      data: { reportId, userId, rawAddress, rawSubject: subject },
    });
  } catch (err) {
    // Don't leave a perpetually-'queued' orphan row if the enqueue fails (e.g. a
    // missing/invalid INNGEST_EVENT_KEY, or an Inngest outage): mark it failed and
    // surface a 502 so the UI shows a clear error instead of a stuck report.
    logger.error({ err, reportId }, 'inngest.send failed; marking report failed');
    await markFailed(reportId, 'Failed to enqueue report generation. Please try again.');
    return Response.json({ error: 'Failed to enqueue report generation' }, { status: 502 });
  }

  return Response.json({ id: reportId }, { status: 201 });
}
