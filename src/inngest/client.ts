// src/inngest/client.ts — Inngest client + typed event schemas for PropResearch.

import { EventSchemas, Inngest } from 'inngest';

/**
 * Typed events for the PropResearch app.
 *
 * Event `reports/generate.requested` is sent by POST /api/reports when a user
 * triggers a new report generation; the `generateReportFn` Inngest function
 * listens for it and calls `runReport`.
 */
export type PropResearchEvents = {
  'reports/generate.requested': {
    data: {
      reportId: string;
      userId: string;
      rawAddress: string;
      rawSubject: unknown;
    };
  };
};

export const inngest = new Inngest({
  id: 'propresearch',
  eventKey: process.env.INNGEST_EVENT_KEY,
  schemas: new EventSchemas().fromRecord<PropResearchEvents>(),
});
