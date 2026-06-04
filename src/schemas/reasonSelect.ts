// Node 06 (reasonAndSelect) output schemas — CLAUDE.md Appendix B.
//
// The keystone node runs as a 3-phase map-reduce to avoid one slow, stall-prone
// gpt-5.4 generation over all 30 comps:
//   1. PLAN    — triage ALL comps → {verdict, shortlist}     (light, non-stalling)
//   2. ANALYSE — deep per-comp work on the shortlist, batched (the "map")
//   3. SELECT  — pick fair-value / anchor over the analysed pool (the "reduce")
// Results are merged back into state.comparables[i].

import { z } from 'zod';
import { CompComparisonSchema, CompVerdictSchema } from './state';

export const ReasonSelectAdjustmentSchema = z.object({
  dimension: z.string(),
  delta: z.number().min(-0.3).max(0.3),
  rationale: z.string().min(20),
});

// --- Phase 1: PLAN (one cheap pass over the whole pool) --------------------
// Verdict for EVERY comp (so the banded chart classifies the full pool) plus a
// shortlist flag marking which comps deserve deep analysis.
export const CompPlanSchema = z.object({
  compId: z.string(),
  verdict: CompVerdictSchema,
  shortlist: z.boolean(),
});
export type CompPlan = z.infer<typeof CompPlanSchema>;

export const ReasonPlanOutputSchema = z.object({
  plans: z.array(CompPlanSchema),
});
export type ReasonPlanOutput = z.infer<typeof ReasonPlanOutputSchema>;

// --- Phase 2: ANALYSE (the map — deep per-comp work on the shortlist) -------
export const CompAnalysisSchema = z.object({
  compId: z.string(),
  // Refined verdict from the deep pass (overrides the plan's quick verdict).
  verdict: CompVerdictSchema,
  comparison: CompComparisonSchema,
  adjustments: z.array(ReasonSelectAdjustmentSchema).max(8),
  adjustmentNarrative: z.string().min(60),
  adjustedValue: z.number(),
  // Set when total adjustments exceed the sane band (~±15%) — the reduce honours
  // it. Keeps the "too-different → reject" gate where the numbers are computed.
  recommendExclude: z.boolean(),
  recommendExcludeReason: z.string().nullable(),
});
export type CompAnalysis = z.infer<typeof CompAnalysisSchema>;

export const ReasonAnalysisOutputSchema = z.object({
  analyses: z.array(CompAnalysisSchema),
});
export type ReasonAnalysisOutput = z.infer<typeof ReasonAnalysisOutputSchema>;

// --- Phase 3: SELECT (the reduce — pick the value set over analysed comps) --
export const CompSelectionSchema = z.object({
  compId: z.string(),
  selection: z.enum(['fair-value', 'negotiation-anchor', 'rejected']),
  rejectionReason: z.string().nullable(),
  selectionRationale: z.string().min(40),
});
export type CompSelection = z.infer<typeof CompSelectionSchema>;

export const ReasonSelectionOutputSchema = z.object({
  selections: z.array(CompSelectionSchema),
});
export type ReasonSelectionOutput = z.infer<typeof ReasonSelectionOutputSchema>;
