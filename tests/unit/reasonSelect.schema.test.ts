// tests/unit/reasonSelect.schema.test.ts
import { ReasonSelectOutputSchema } from '@/schemas/reasonSelect';
import { describe, expect, it } from 'vitest';

const decision = {
  compId: 'c1',
  selection: 'fair-value' as const,
  rejectionReason: null,
  adjustments: [
    { dimension: 'land-area', delta: 0.05, rationale: 'subject has more land than this comp' },
  ],
  adjustmentNarrative: 'Adjusted up modestly for the larger parcel and similar condition overall.',
  adjustedValue: 2_600_000,
  selectionRationale: 'Strong like-for-like match on beds, baths and street quality.',
};

describe('ReasonSelectOutputSchema', () => {
  it('accepts an adjustment with no sourceRef (LLM does not emit pointers)', () => {
    const parsed = ReasonSelectOutputSchema.parse({ decisions: [decision] });
    expect(parsed.decisions[0]?.adjustments[0]).toEqual({
      dimension: 'land-area',
      delta: 0.05,
      rationale: 'subject has more land than this comp',
    });
  });

  it('rejects a delta outside [-0.3, 0.3]', () => {
    const bad = {
      ...decision,
      adjustments: [{ dimension: 'x', delta: 0.5, rationale: 'way too large an adjustment here' }],
    };
    expect(ReasonSelectOutputSchema.safeParse({ decisions: [bad] }).success).toBe(false);
  });
});
