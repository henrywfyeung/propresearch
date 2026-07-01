// Shared Sentry helpers — DSN resolution + a PII scrubber applied via beforeSend
// in every runtime config (CLAUDE.md §14.1 / [R49]). Address / listing / report-
// state fields must not leave the process for Sentry's US/EU servers.

import type { ErrorEvent, EventHint } from '@sentry/nextjs';

export const SENTRY_DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

// Keys whose values are redacted wherever they appear in an event payload.
const SENSITIVE_KEYS = new Set([
  'address',
  'subjectaddress',
  'rawaddress',
  'normalizedaddress',
  'listing',
  'comparable',
  'comparables',
  'subject',
  'photos',
  'floorplans',
  'streetview',
  'state',
]);

function redact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** beforeSend hook: strip PII-adjacent fields from contexts/extra/request data. */
export function scrubEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent {
  if (event.contexts) event.contexts = redact(event.contexts) as ErrorEvent['contexts'];
  if (event.extra) event.extra = redact(event.extra) as ErrorEvent['extra'];
  if (event.request?.data) event.request.data = redact(event.request.data);
  return event;
}
