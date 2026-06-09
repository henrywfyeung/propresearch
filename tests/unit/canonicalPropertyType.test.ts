// tests/unit/canonicalPropertyType.test.ts
import { CanonicalPropertyTypeSchema } from '@/schemas/state';
import { describe, expect, it } from 'vitest';

describe('CanonicalPropertyTypeSchema', () => {
  it('accepts the canonical vocab', () => {
    for (const t of ['House', 'ApartmentUnitFlat', 'Townhouse', 'Villa', 'Land', 'Other']) {
      expect(CanonicalPropertyTypeSchema.parse(t)).toBe(t);
    }
  });
  it('rejects non-canonical values', () => {
    expect(CanonicalPropertyTypeSchema.safeParse('apartment').success).toBe(false);
    expect(CanonicalPropertyTypeSchema.safeParse('house').success).toBe(false);
  });
});
