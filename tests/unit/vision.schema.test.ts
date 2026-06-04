// tests/unit/vision.schema.test.ts — the granular layout block is a required,
// frozen-enum part of the vision output ([R42]): drift surfaces as a parse
// failure, not silent wording change.

import { CompVisionSchema, SubjectVisionSchema } from '@/schemas/vision';
import { describe, expect, it } from 'vitest';

const baseSubject = {
  condition: 'good' as const,
  staging: 'vacant' as const,
  presentationFactors: [],
  redFlags: [],
  comment: 'A sufficiently long conservative inspector comment for the schema test here.',
};

const layout = {
  storeys: 'single' as const,
  structure: 'attached-unit' as const,
  positionInComplex: 'ground-floor' as const,
  singleLevelLiving: true,
  streetFrontage: 'shared-driveway' as const,
  era: 'late-20th-century' as const,
  configNotes: ['1x downstairs bedroom'],
};

describe('SubjectVisionSchema layout', () => {
  it('accepts a full layout block', () => {
    expect(SubjectVisionSchema.safeParse({ ...baseSubject, layout }).success).toBe(true);
  });

  it('requires the layout block', () => {
    expect(SubjectVisionSchema.safeParse(baseSubject).success).toBe(false);
  });

  it('rejects an out-of-enum storeys value', () => {
    const bad = { ...baseSubject, layout: { ...layout, storeys: 'triple' } };
    expect(SubjectVisionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CompVisionSchema layout', () => {
  const baseComp = { condition: 'fair' as const, presentationFactors: [], redFlags: [] };

  it('requires the light layout block (storeys / structure / era)', () => {
    expect(CompVisionSchema.safeParse(baseComp).success).toBe(false);
    expect(
      CompVisionSchema.safeParse({
        ...baseComp,
        layout: { storeys: 'double', structure: 'free-standing', era: 'contemporary' },
      }).success,
    ).toBe(true);
  });
});
