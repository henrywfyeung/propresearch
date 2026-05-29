import { type SimilaritySubject, similarityScore } from '@/tools/comps/similarity';
// Golden tests for the §7.3 similarity formula.
import { describe, expect, it } from 'vitest';

const subject: SimilaritySubject = {
  beds: 3,
  baths: 2,
  landArea: 600,
  propertyType: 'House',
};

const perfect = {
  beds: 3,
  baths: 2,
  landArea: 600,
  propertyType: 'House',
  weeksSinceSale: 4,
  distanceM: 200,
};

describe('similarityScore', () => {
  it('a fresh, identical, on-top comp scores 100', () => {
    expect(similarityScore(subject, perfect)).toBe(100);
  });

  it('caps the recency deduction at 30 (>34 weeks old)', () => {
    expect(similarityScore(subject, { ...perfect, weeksSinceSale: 100 })).toBe(70);
  });

  it('caps the distance deduction at 25', () => {
    // (distanceM - 200)/100 capped at 25 → distance 5000m exceeds the cap.
    expect(similarityScore(subject, { ...perfect, distanceM: 5000 })).toBe(75);
  });

  it('deducts 10 per bed difference and 8 per bath difference', () => {
    expect(similarityScore(subject, { ...perfect, beds: 4 })).toBe(90);
    expect(similarityScore(subject, { ...perfect, baths: 4 })).toBe(84); // 2 baths off × 8
  });

  it('deducts 20 for a different property type (and skips land-area for non-houses)', () => {
    // Unit type → -20; land-area deduction skipped because subject is House
    // but candidate differs; the §7.3 land rule only runs for House subjects
    // and uses the subject's own type gate, so the -20 stands alone here.
    expect(similarityScore(subject, { ...perfect, propertyType: 'Unit' })).toBe(80);
  });

  it('applies progressive land-area deduction for houses, capped at 15', () => {
    // 50% larger land → floor(0.5*10)=5 deducted.
    expect(similarityScore(subject, { ...perfect, landArea: 900 })).toBe(95);
    // 300% larger → floor(3*10)=30 but capped at 15.
    expect(similarityScore(subject, { ...perfect, landArea: 2400 })).toBe(85);
  });

  it('never returns below 0', () => {
    const awful = {
      beds: 0,
      baths: 0,
      landArea: 50,
      propertyType: 'Unit',
      weeksSinceSale: 200,
      distanceM: 9000,
    };
    expect(similarityScore(subject, awful)).toBe(0);
  });
});
