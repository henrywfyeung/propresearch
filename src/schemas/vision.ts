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

// --------------------------------------------------------------------------
// Granular layout / configuration attributes (adopted from a professional
// CMA's subject-property description). FROZEN enums per [R42]; every enum
// carries 'unknown' so vision always has a valid value when it can't tell.
// These are the structural facts a valuer reasons over (storeys, shared walls,
// position in a block, single-level living, era) — the backbone of the
// Size/Layout comparison axes. Exact build-year / "block of N units" are not
// reliably visible in photos, so we capture an era band + free-text notes
// instead; the schema can later be overridden by user-supplied ground truth.
// --------------------------------------------------------------------------

export const StoreysSchema = z.enum(['single', 'double', 'split-level', 'multi', 'unknown']);

// Shared-walls signal: free-standing (none) → semi-detached (one) →
// terraced/row (both) → attached-unit (apartment/unit in a larger building).
export const StructureSchema = z.enum([
  'free-standing',
  'semi-detached',
  'terraced',
  'attached-unit',
  'unknown',
]);

export const EraSchema = z.enum([
  'period-pre-1945',
  'mid-century',
  'late-20th-century',
  'contemporary',
  'new-build',
  'unknown',
]);

// Light layout block shared by comps (robustly inferable from a few photos).
export const CompLayoutSchema = z.object({
  storeys: StoreysSchema,
  structure: StructureSchema,
  era: EraSchema,
});
export type CompLayout = z.infer<typeof CompLayoutSchema>;

// Position of a dwelling within a multi-unit complex (units/townhouses).
// 'not-applicable' for a free-standing house.
export const PositionInComplexSchema = z.enum([
  'not-applicable',
  'front',
  'rear',
  'middle',
  'ground-floor',
  'upper-floor',
  'unknown',
]);

export const StreetFrontageSchema = z.enum([
  'own-frontage',
  'shared-driveway',
  'battle-axe',
  'unknown',
]);

// Full layout block for the subject (richer sources: floorplan + Street View).
export const SubjectLayoutSchema = CompLayoutSchema.extend({
  positionInComplex: PositionInComplexSchema,
  // true = all living + a bed/bath on one level (e.g. a downstairs bedroom);
  // false = bedrooms only upstairs; null = can't tell from the imagery.
  singleLevelLiving: z.boolean().nullable(),
  streetFrontage: StreetFrontageSchema,
  // Specific granular notes, e.g. "1x downstairs bedroom", "no shared walls".
  configNotes: cappedStringArray(4),
});
export type SubjectLayout = z.infer<typeof SubjectLayoutSchema>;

// Node 04a — subject vision.
export const SubjectVisionSchema = z.object({
  condition: ConditionSchema,
  staging: StagingSchema,
  presentationFactors: cappedStringArray(6),
  redFlags: cappedStringArray(6),
  /** Granular layout / configuration read from photos + floorplan. */
  layout: SubjectLayoutSchema,
  /** Human-readable visual-inspection comment. Inspector-style, conservative. */
  comment: z.string().min(40),
});
export type SubjectVision = z.infer<typeof SubjectVisionSchema>;

// Node 04b — per-comp vision (condition reuses the same enum).
export const CompVisionSchema = z.object({
  condition: ConditionSchema,
  presentationFactors: cappedStringArray(6),
  redFlags: cappedStringArray(6),
  /** Light layout block (storeys / structure / era) from the comp's photos. */
  layout: CompLayoutSchema,
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
