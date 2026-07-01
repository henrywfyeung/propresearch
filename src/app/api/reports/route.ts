// src/app/api/reports/route.ts — POST /api/reports
//
// Triggers a new report generation:
//   1. Auth gate (requireAllowedUser)
//   2. Zod-validate the request body
//   3. Per-user daily rate limit (§11.1) — protects LLM spend on the shared key
//   4. createReport → insert queued row
//   5. inngest.send → enqueue the generation function
//   6. Return 201 { id }

export const runtime = 'nodejs';

import { DAILY_REPORT_LIMIT, bumpDailyReportCount } from '@/db/rate-limit';
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

  // Per-user daily cap — each report spends ~$0.55 of LLM budget on the shared
  // key, so bound triggers (§11.1). Atomic increment-and-check.
  const dailyCount = await bumpDailyReportCount(userId);
  if (dailyCount > DAILY_REPORT_LIMIT) {
    logger.warn({ userId, dailyCount }, 'daily report limit reached');
    return Response.json(
      {
        error: `Daily limit of ${DAILY_REPORT_LIMIT} reports reached. Please try again tomorrow.`,
      },
      { status: 429 },
    );
  }

  const reportId = await createReport(userId);

  try {
    await inngest.send({
      name: 'reports/generate.requested',
      // buildSubject expects { attrs, photos } (the CLI shape). The form posts a
      // flat attrs object; wrap it here. photos start empty — Node 04a auto-fetches
      // the REA listing photos at run time (user photo upload is a later increment).
      data: { reportId, userId, rawAddress, rawSubject: { attrs: subject, photos: [] } },
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
