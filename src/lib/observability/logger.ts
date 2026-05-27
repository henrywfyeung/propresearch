// Pino logger with PII redaction per CLAUDE.md §14.1 / [R49].
//
// Listing-derived data (Domain photos, comp addresses, AVM payloads) is
// PII for Privacy Act 1988 purposes AND TOS-sensitive — it must not leak
// into Vercel logs, Sentry breadcrumbs, or anywhere we don't fully control.
// The redaction list below is the single source of truth.

import pino from 'pino';

const REDACT_PATHS = [
  // Secrets
  '*.api_key',
  '*.apiKey',
  '*.token',
  '*.authorization',
  'authorization',
  '*.password',

  // PII / listing data — R49 explicitly extends pino's redaction set to
  // address fields and listing payloads so Sentry breadcrumbs etc. don't
  // exfiltrate Domain-derived content.
  '*.address',
  '*.subjectAddress',
  'state.subject',
  'state.comparables',
  '*.listing',
  '*.photos',
] as const;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: [...REDACT_PATHS],
    censor: '[REDACTED]',
  },
  // Useful in Vercel logs: include level name, not just numeric level.
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  base: {
    // Service tag so Sentry / Vercel logs can filter by source.
    service: 'propresearch',
  },
});

/**
 * Helper: returns a child logger bound to a report id. Use this whenever a
 * graph node or API handler is working on a known report — every log line
 * gets `reportId` automatically, which makes Langfuse trace correlation
 * trivial.
 */
export function reportLogger(reportId: string) {
  return logger.child({ reportId });
}
