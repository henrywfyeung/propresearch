// tests/unit/buildSubject.test.ts
import { buildSubject } from '@/agents/subject';
import { describe, expect, it } from 'vitest';

const raw = {
  attrs: {
    beds: 3,
    baths: 2,
    parking: 1,
    landArea: 500,
    buildingArea: null,
    propertyType: 'House',
  },
  photos: ['https://example.com/a.jpg'],
};

describe('buildSubject', () => {
  it('validates + normalizes a raw subject into SubjectProperty', () => {
    const s = buildSubject(raw);
    expect(s.attrs.propertyType).toBe('House');
    expect(s.photos).toEqual(['https://example.com/a.jpg']);
    expect(s.listing).toBeNull();
    expect(s.visionAnalysis).toBeNull();
    expect(s.streetView).toBeNull();
  });

  it('throws on a non-canonical propertyType', () => {
    expect(() =>
      buildSubject({ ...raw, attrs: { ...raw.attrs, propertyType: 'apartment' } }),
    ).toThrow();
  });

  it('throws on a missing required attr', () => {
    expect(() => buildSubject({ attrs: { beds: 3 }, photos: [] })).toThrow();
  });
});
