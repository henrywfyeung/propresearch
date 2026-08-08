// src/app/api/inngest/route.ts — Inngest webhook handler for the PropResearch app.
//
// `serve()` handles:
//   - signature verification via INNGEST_SIGNING_KEY ([R45])
//   - replay-window checking (rejects stale requests with > 5 min skew)
//   - GET for the Inngest dashboard introspection handshake
//   - POST for event delivery / function invocation
//   - PUT for function registration syncs
//
// The middleware matcher already excludes /api/inngest from auth gates.
// This route must run on the Node.js runtime (not Edge) because the
// Inngest worker executes runReport → db (unified Cloud SQL client,
// which requires Node TCP sockets).

export const runtime = 'nodejs';
// The report pipeline (graph + Puppeteer PDF render) runs inside this handler in
// a single invocation; give it the Vercel Pro ceiling so it isn't killed mid-render.
export const maxDuration = 300;

import { inngest } from '@/inngest/client';
import { generateReportFn } from '@/inngest/functions/generateReport';
import { serve } from 'inngest/next';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generateReportFn],
});
