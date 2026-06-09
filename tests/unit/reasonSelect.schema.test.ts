// tests/unit/reasonSelect.schema.test.ts — the 3-phase Node 06 output schemas.
import {
  ReasonAnalysisOutputSchema,
  ReasonPlanOutputSchema,
  ReasonSelectionOutputSchema,
} from '@/schemas/reasonSelect';
import { describe, expect, it } from 'vitest';

describe('ReasonPlanOutputSchema', () => {
  it('accepts a verdict + shortlist flag per comp', () => {
    const ok = ReasonPlanOutputSchema.safeParse({
      plans: [
        { compId: 'a', verdict: 'comparable', shortlist: true },
        { compId: 'b', verdict: 'inferior', shortlist: false },
      ],
    });
    expect(ok.success).toBe(true);
  });
  it('rejects an out-of-enum verdict', () => {
    expect(
      ReasonPlanOutputSchema.safeParse({
        plans: [{ compId: 'a', verdict: 'meh', shortlist: true }],
      }).success,
    ).toBe(false);
  });
});

const analysis = {
  compId: 'c1',
  verdict: 'comparable' as const,
  comparison: {
    size: 'Similar 540m² block',
    layout: 'Same 3/2 single-storey layout',
    condition: 'Comparable presentation',
    location: 'Same street precinct',
  },
  adjustments: [
    { dimension: 'land-area', delta: 0.05, rationale: 'subject has more land than this comp' },
  ],
  adjustmentNarrative: 'Adjusted up modestly for the larger parcel and similar condition overall.',
  adjustedValue: 2_600_000,
  recommendExclude: false,
  recommendExcludeReason: null,
};

describe('ReasonAnalysisOutputSchema', () => {
  it('accepts a per-comp analysis with adjustments + recommendExclude', () => {
    expect(ReasonAnalysisOutputSchema.safeParse({ analyses: [analysis] }).success).toBe(true);
  });
  it('rejects a delta outside [-0.3, 0.3]', () => {
    const bad = {
      ...analysis,
      adjustments: [{ dimension: 'x', delta: 0.5, rationale: 'way too large an adjustment here' }],
    };
    expect(ReasonAnalysisOutputSchema.safeParse({ analyses: [bad] }).success).toBe(false);
  });
});

describe('ReasonSelectionOutputSchema', () => {
  it('accepts a selection per comp', () => {
    const ok = ReasonSelectionOutputSchema.safeParse({
      selections: [
        {
          compId: 'a',
          selection: 'fair-value',
          rejectionReason: null,
          selectionRationale: 'Strong like-for-like match on beds, baths and street quality.',
        },
      ],
    });
    expect(ok.success).toBe(true);
  });
  it("rejects 'candidate' (not a valid final selection)", () => {
    expect(
      ReasonSelectionOutputSchema.safeParse({
        selections: [
          {
            compId: 'a',
            selection: 'candidate',
            rejectionReason: null,
            selectionRationale: 'x'.repeat(40),
          },
        ],
      }).success,
    ).toBe(false);
  });
});
