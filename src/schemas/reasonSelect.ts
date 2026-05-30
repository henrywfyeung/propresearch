// Node 06 keystone output — CLAUDE.md Appendix B. GPT-5 high-reasoning returns
// this; decisions are merged back into state.comparables[i].

import { z } from 'zod';

export const ReasonSelectAdjustmentSchema = z.object({
  dimension: z.string(),
  delta: z.number().min(-0.3).max(0.3),
  rationale: z.string().min(20),
});

export const ComparableDecisionSchema = z.object({
  compId: z.string(),
  selection: z.enum(['fair-value', 'negotiation-anchor', 'rejected', 'candidate']),
  rejectionReason: z.string().nullable(),
  adjustments: z.array(ReasonSelectAdjustmentSchema).max(8),
  adjustmentNarrative: z.string().min(60),
  adjustedValue: z.number(),
  selectionRationale: z.string().min(40),
});
export type ComparableDecision = z.infer<typeof ComparableDecisionSchema>;

export const ReasonSelectOutputSchema = z.object({
  decisions: z.array(ComparableDecisionSchema),
});
export type ReasonSelectOutput = z.infer<typeof ReasonSelectOutputSchema>;
