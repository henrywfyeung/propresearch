// Drizzle schema — source of truth for all DB structure.
// Mirrors CLAUDE.md §4.2. Every table referenced by an `[Rxx]` tag is annotated.
//
// Conventions:
// - All money values: numeric(10,4) for report-level totals, numeric(10,6) per LLM call.
// - All timestamps stored as `timestamptz` (`withTimezone: true`).
// - `state.subjectAddress` and `state.domainPropertyId` are denormalised TOP-LEVEL
//   columns on `reports` — the only sanctioned cross-row search keys ([R25] / [R51]).

import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// --------------------------------------------------------------------------
// Enums
// --------------------------------------------------------------------------

export const reportStatus = pgEnum('report_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'superseded',
]);

export const emailStatus = pgEnum('email_status', ['pending', 'sent', 'failed']);

export const llmProvider = pgEnum('llm_provider', ['openai', 'anthropic']);

// --------------------------------------------------------------------------
// users — mirrors Supabase auth.users via email join.
// --------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
  }),
);

// --------------------------------------------------------------------------
// allowed_emails — the only people who can log in. Edits trigger session-bust [R5].
// --------------------------------------------------------------------------

export const allowedEmails = pgTable('allowed_emails', {
  email: text('email').primaryKey(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  addedBy: text('added_by'),
  note: text('note'),
});

// --------------------------------------------------------------------------
// reports — one row per generation request.
// --------------------------------------------------------------------------

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: reportStatus('status').notNull().default('queued'),
    version: integer('version').notNull().default(1),
    supersedesId: uuid('supersedes_id').references((): AnyPgColumn => reports.id, {
      onDelete: 'set null',
    }),
    // Full per-report snapshot — point-in-time, by-id-only access ([R3]).
    // 90-day TTL via the nightly purge cron (F6).
    state: jsonb('state'),
    // Denormalised search keys — the only top-level columns lifted from `state`.
    // [R25] subjectAddress for ILIKE dashboard search; [R51] domainPropertyId for dedupe.
    subjectAddress: text('subject_address'),
    domainPropertyId: text('domain_property_id'),
    pdfUrl: text('pdf_url'),
    totalCostUsd: numeric('total_cost_usd', { precision: 10, scale: 4 }),
    totalTokens: integer('total_tokens'),
    currentNode: text('current_node'),
    errorMessage: text('error_message'),
    emailErrorMessage: text('email_error_message'),
    emailStatus: emailStatus('email_status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    byUserCreated: index('reports_user_created_idx').on(t.userId, t.createdAt.desc()),
    // Partial index for the dedupe lookup ([R51]).
    dedupeByProperty: index('reports_dedupe_idx')
      .on(t.domainPropertyId, t.createdAt.desc())
      .where(sql`status IN ('succeeded', 'running')`),
    // Trigram index on subject_address is created in 0001_postgis_pg_trgm.sql
    // (after pg_trgm extension exists). Drizzle-kit can't generate the
    // gin_trgm_ops opclass cleanly, so we keep it hand-written.
    runningIdx: index('reports_running_idx').on(t.updatedAt).where(sql`status = 'running'`),
  }),
);

// --------------------------------------------------------------------------
// audit_log — append-only, IDs-only payload (no listing fields) [R3].
// --------------------------------------------------------------------------

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    action: text('action').notNull(), // 'report.requested' | 'report.succeeded' | 'user.purged' | ...
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    reportId: uuid('report_id').references(() => reports.id, { onDelete: 'set null' }),
    details: jsonb('details').notNull(), // IDs + status + costs only; validated by Zod at write site
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byActorCreated: index('audit_actor_created_idx').on(t.actorUserId, t.createdAt.desc()),
    byActionCreated: index('audit_action_created_idx').on(t.action, t.createdAt.desc()),
  }),
);

// --------------------------------------------------------------------------
// nsw_vg_sales — bulk-ingested NSW Valuer General sales (open government data).
// PostGIS Point geometry for spatial queries (ST_DWithin) in Node 03.
// --------------------------------------------------------------------------

export const nswVgSales = pgTable(
  'nsw_vg_sales',
  {
    propId: text('prop_id').notNull(),
    contractDate: timestamp('contract_date', { mode: 'date' }).notNull(),
    purchasePrice: numeric('purchase_price', { precision: 14, scale: 2 }).notNull(),
    address: text('address').notNull(),
    suburb: varchar('suburb', { length: 80 }),
    postcode: varchar('postcode', { length: 4 }),
    district: text('district'),
    zoneCode: varchar('zone_code', { length: 8 }),
    propertyType: text('property_type'),
    landAreaSqm: numeric('land_area_sqm', { precision: 12, scale: 2 }),
    natureOfProperty: varchar('nature_of_property', { length: 8 }),
    // `geom geometry(Point, 4326)` is added in 0001_postgis_pg_trgm.sql.
    // Drizzle-kit doesn't model PostGIS types; application queries use the
    // sql`` tag for ST_DWithin / ST_MakePoint.
    settlementDate: timestamp('settlement_date', { mode: 'date' }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.propId, t.contractDate] }),
    bySuburbPostcode: index('nsw_vg_suburb_postcode_idx').on(t.suburb, t.postcode),
    byContractDate: index('nsw_vg_contract_date_idx').on(t.contractDate),
    // GIST index on `geom` is created via raw SQL — Drizzle's index API
    // doesn't support GIST opclasses against geometry types directly.
  }),
);

// --------------------------------------------------------------------------
// llm_calls — per-call ledger; the source of truth for cost reconstruction ([R24]).
// --------------------------------------------------------------------------

export const llmCalls = pgTable(
  'llm_calls',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    reportId: uuid('report_id').references(() => reports.id, { onDelete: 'cascade' }),
    node: text('node').notNull(), // 'reasonAndSelect' | 'compose:valuation' | ...
    provider: llmProvider('provider').notNull(),
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull(),
    latencyMs: integer('latency_ms'),
    succeeded: text('succeeded').notNull().default('true'), // 'true' | 'false' (text for trivial SQL filter)
    langfuseTraceId: text('langfuse_trace_id'),
    promptVersion: text('prompt_version'), // [R30] regression baseline pin
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byReport: index('llm_calls_report_idx').on(t.reportId),
    byProviderCreated: index('llm_calls_provider_created_idx').on(t.provider, t.createdAt.desc()),
  }),
);

// --------------------------------------------------------------------------
// rate_limit_counters — per-user per-day counter. Incremented on REQUEST (each
// trigger spends LLM budget on the shared key, so the cap must bound triggers;
// see src/db/rate-limit.ts) — this supersedes the original [R6] on-success plan.
// --------------------------------------------------------------------------

export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: text('day').notNull(), // YYYY-MM-DD in AEST
    count: integer('count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.day] }),
  }),
);

// --------------------------------------------------------------------------
// report_versions — one row per generation, linked to the canonical R2 PDF.
// [R7] versioning + history.
// --------------------------------------------------------------------------

export const reportVersions = pgTable(
  'report_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    pdfUrl: text('pdf_url').notNull(),
    stateSnapshotKey: text('state_snapshot_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byReportVersion: uniqueIndex('report_versions_report_version_idx').on(t.reportId, t.version),
  }),
);

// --------------------------------------------------------------------------
// report_node_artifacts — mid-node durability side table [R21].
// PK (reportId, node, itemKey) — the table that lets per-item work survive
// a worker crash, since LangGraph's PostgresSaver only checkpoints at
// super-step boundaries (CLAUDE.md §6.3).
// --------------------------------------------------------------------------

export const reportNodeArtifacts = pgTable(
  'report_node_artifacts',
  {
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    node: text('node').notNull(), // 'visionComps' | 'risks' | 'compose' | 'revise'
    itemKey: text('item_key').notNull(), // compId | category | sectionId | 'iter-N'
    revisionRound: integer('revision_round').notNull().default(0),
    payload: jsonb('payload').notNull(),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.reportId, t.node, t.itemKey] }),
  }),
);

// --------------------------------------------------------------------------
// pending_stats_callbacks — durable retry queue for Domain stats events [R37].
// --------------------------------------------------------------------------

export const pendingStatsCallbacks = pgTable(
  'pending_stats_callbacks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    listingId: text('listing_id').notNull(),
    payload: jsonb('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byNextAttempt: index('pending_stats_next_attempt_idx').on(t.nextAttemptAt),
  }),
);

// --------------------------------------------------------------------------
// Type exports for the app
// --------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type LlmCall = typeof llmCalls.$inferSelect;
export type NewLlmCall = typeof llmCalls.$inferInsert;
export type ReportNodeArtifact = typeof reportNodeArtifacts.$inferSelect;
export type ReportVersion = typeof reportVersions.$inferSelect;
