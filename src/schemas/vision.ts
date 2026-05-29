// Vision-analysis output schemas — CLAUDE.md §7.4 / [R42]. Enums are FROZEN
// at the Zod boundary so downstream prose stays consistent run-to-run and
// any model drift surfaces as a parse failure rather than silent wording
// changes. Open string arrays are length- and char-capped to prevent prose
// bloat in the PDF.

import { z } from 'zod';

export const ConditionSchema = z.enum(['excellent', 'good', 'fair', 'poor', 'unliveable']);
export type Condition = z.infer<typeof ConditionSchema>;

export const StagingSchema = z.enum([
  'professionally-staged',
  'lived-in-tidy',
  'lived-in-cluttered',
  'vacant',
  'partly-furnished',
]);

const cappedStringArray = (maxItems: number) => z.array(z.string().max(80)).max(maxItems);

// Node 04a — subject vision.
export const SubjectVisionSchema = z.object({
  condition: ConditionSchema,
  staging: StagingSchema,
  presentationFactors: cappedStringArray(6),
  redFlags: cappedStringArray(6),
});
export type SubjectVision = z.infer<typeof SubjectVisionSchema>;

// Node 04b — per-comp vision (condition reuses the same enum).
export const CompVisionSchema = z.object({
  condition: ConditionSchema,
  presentationFactors: cappedStringArray(6),
  redFlags: cappedStringArray(6),
});
export type CompVision = z.infer<typeof CompVisionSchema>;

// Node 04c — street view.
export const StreetCharacterSchema = z.enum([
  'leafy-residential',
  'arterial',
  'commercial-frontage',
  'industrial-adjacent',
  'mixed',
  'unclassified',
]);

export const StreetViewSchema = z.object({
  streetCharacter: StreetCharacterSchema,
  busyRoad: z.boolean(),
  treeCover: z.enum(['high', 'medium', 'low']),
  neighbouringConcerns: cappedStringArray(4),
});
export type StreetView = z.infer<typeof StreetViewSchema>;
