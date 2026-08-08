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
