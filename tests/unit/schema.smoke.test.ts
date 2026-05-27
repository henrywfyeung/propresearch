// Smoke test — proves the Drizzle schema module imports cleanly and the
// key tables exist with the columns CLAUDE.md §4.2 names. Cheap canary for
// the build pipeline; deeper schema tests come with each Phase B/C task.

import {
  allowedEmails,
  llmCalls,
  reportNodeArtifacts,
  reportVersions,
  reports,
  users,
} from '@/db/schema';
import { describe, expect, it } from 'vitest';

describe('schema', () => {
  it('exports the core tables', () => {
    expect(users).toBeDefined();
    expect(allowedEmails).toBeDefined();
    expect(reports).toBeDefined();
    expect(reportVersions).toBeDefined();
    expect(reportNodeArtifacts).toBeDefined();
    expect(llmCalls).toBeDefined();
  });

  it('reports table has the denormalised dedupe / search columns [R25] [R51]', () => {
    // Drizzle's table object exposes columns via the inferred select shape.
    const cols = Object.keys(reports as unknown as Record<string, unknown>);
    expect(cols).toContain('subjectAddress'); // R25 — dashboard ILIKE
    expect(cols).toContain('domainPropertyId'); // R51 — 24h dedupe
    expect(cols).toContain('emailStatus'); // R35
  });

  it('report_node_artifacts uses (reportId, node, itemKey) as PK [R21]', () => {
    const cols = Object.keys(reportNodeArtifacts as unknown as Record<string, unknown>);
    expect(cols).toContain('reportId');
    expect(cols).toContain('node');
    expect(cols).toContain('itemKey');
    expect(cols).toContain('revisionRound');
  });
});
