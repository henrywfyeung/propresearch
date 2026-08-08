// Smoke test — proves the Drizzle schema module imports cleanly and the tables
// the app actually uses exist with the columns CLAUDE.md §4.2 names.
//
// The GCP migration dropped five tables that were declared but never
// referenced by any code and held zero rows: audit_log, nsw_vg_sales,
// report_versions, report_node_artifacts and pending_stats_callbacks. They are
// recoverable from git history if the features CLAUDE.md describes (report
// versioning, mid-node durability, NSW VG bulk ingest) are ever built.

import { allowedEmails, llmCalls, rateLimitCounters, reports, users } from '@/db/schema';
import { describe, expect, it } from 'vitest';

describe('schema', () => {
  it('exports the tables the application uses', () => {
    expect(users).toBeDefined();
    expect(allowedEmails).toBeDefined();
    expect(reports).toBeDefined();
    expect(llmCalls).toBeDefined();
    expect(rateLimitCounters).toBeDefined();
  });

  it('reports table has the denormalised dedupe / search columns [R25] [R51]', () => {
    // Drizzle's table object exposes columns via the inferred select shape.
    const cols = Object.keys(reports as unknown as Record<string, unknown>);
    expect(cols).toContain('subjectAddress'); // R25 — dashboard ILIKE
    expect(cols).toContain('domainPropertyId'); // R51 — 24h dedupe
    expect(cols).toContain('emailStatus'); // R35
  });

  it('reports table carries the status lifecycle columns the UI polls', () => {
    const cols = Object.keys(reports as unknown as Record<string, unknown>);
    expect(cols).toContain('status');
    expect(cols).toContain('currentNode');
    expect(cols).toContain('pdfUrl');
    expect(cols).toContain('errorMessage');
  });

  it('llm_calls carries the per-call cost ledger the ceiling depends on', () => {
    const cols = Object.keys(llmCalls as unknown as Record<string, unknown>);
    expect(cols).toContain('reportId');
    expect(cols).toContain('costUsd');
    expect(cols).toContain('provider');
  });
});
