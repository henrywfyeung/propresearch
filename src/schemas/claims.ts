// Structured claims — CLAUDE.md §7.12 / [R4]. Compose emits ClaimBlock[] per
// section instead of free prose, so the critic (§7.13 Pass 1) can diff claim
// values against state deterministically rather than regexing text. Prose is
// rendered from blocks at PDF time via renderClaim().

import { z } from 'zod';
import { SourceRefSchema } from './sources';

export const SectionIdSchema = z.enum([
  'summary',
  'subject',
  'valuation',
  'comparables',
  'rentals',
  'market',
  'risks',
  'planning',
  'negotiation',
]);
export type SectionId = z.infer<typeof SectionIdSchema>;

export const ClaimFormatSchema = z.enum([
  'currency-aud',
  'percent',
  'count',
  'date',
  'distance-m',
  'duration-days',
]);
export type ClaimFormat = z.infer<typeof ClaimFormatSchema>;

export const ClaimBlockSchema = z.discriminatedUnion('type', [
  // Narrative text — no numbers; critic checks via embedding similarity, not values.
  z.object({ type: z.literal('text'), text: z.string() }),
  // Single numeric/string claim.
  z.object({
    type: z.literal('claim'),
    text: z.string(), // e.g. "Median price rose {{v}} YoY"
    value: z.union([z.number(), z.string()]),
    format: ClaimFormatSchema,
    sourceRef: SourceRefSchema,
  }),
  // Range claim, e.g. an estimated value band.
  z.object({
    type: z.literal('range'),
    text: z.string(), // "Estimated value {{lo}}–{{hi}}"
    low: z.number(),
    high: z.number(),
    format: z.enum(['currency-aud', 'percent']),
    sourceRef: SourceRefSchema,
  }),
  // Explicit reference to a comparable.
  z.object({
    type: z.literal('comp-ref'),
    text: z.string(),
    compId: z.string(),
  }),
]);
export type ClaimBlock = z.infer<typeof ClaimBlockSchema>;

export const ReportProseSchema = z.record(SectionIdSchema, z.array(ClaimBlockSchema));
export type ReportProse = z.infer<typeof ReportProseSchema>;
