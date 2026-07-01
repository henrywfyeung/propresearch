// Next.js instrumentation hook — loads the Sentry runtime config for the active
// runtime (CLAUDE.md §14.1). Each config no-ops without a DSN, so this is inert
// until SENTRY_DSN is set.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

// Captures errors thrown in nested React Server Components (Next 15 hook).
export const onRequestError = Sentry.captureRequestError;
