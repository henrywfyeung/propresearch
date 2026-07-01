// Server-runtime Sentry init. Dormant until SENTRY_DSN is set (see docs/deploy.md).
import * as Sentry from '@sentry/nextjs';
import { SENTRY_DSN, scrubEvent } from '@/lib/observability/sentry';

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
