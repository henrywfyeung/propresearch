// Browser Sentry init. Dormant until NEXT_PUBLIC_SENTRY_DSN is set. No Session
// Replay (it would capture the report UI, i.e. address/listing data).
import * as Sentry from '@sentry/nextjs';
import { scrubEvent } from '@/lib/observability/sentry';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
