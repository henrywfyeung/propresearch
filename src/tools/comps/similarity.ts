// Comparable similarity scoring — CLAUDE.md §7.3. Pure function, no I/O.
// Used by Node 03 to rank the 30-candidate pool before the LLM does final
// selection/adjustment in Node 06. Start at 100, deduct.

export interface SimilaritySubject {
  beds: number;
  baths: number;
  landArea: number | null;
  propertyType: string;
}

export interface SimilarityCandidate {
  beds: number;
  baths: number;
  landArea: number | null;
  propertyType: string;
  weeksSinceSale: number;
  distanceM: number;
}

/**
 * Returns a 0–100 similarity score. Exactly the deductions specified in
 * CLAUDE.md §7.3:
 *   recency   : -min(30, max(0, weeksSinceSale - 4))
 *   distance  : -min(25, max(0, (distanceM - 200) / 100))
 *   beds      : -|Δbeds| * 10
 *   baths     : -|Δbaths| * 8
 *   type      : -20 if propertyType differs
 *   land area : houses only, -min(15, floor(pctDiff * 10))
 */
export function similarityScore(subject: SimilaritySubject, c: SimilarityCandidate): number {
  let s = 100;

  // recency
  s -= Math.max(0, Math.min(30, c.weeksSinceSale - 4));

  // distance
  s -= Math.max(0, Math.min(25, (c.distanceM - 200) / 100));

  // beds / baths
  s -= Math.abs(c.beds - subject.beds) * 10;
  s -= Math.abs(c.baths - subject.baths) * 8;

  // property type
  if (c.propertyType !== subject.propertyType) s -= 20;

  // land area — houses only, and only when both areas are known
  if (
    subject.propertyType === 'House' &&
    subject.landArea != null &&
    subject.landArea > 0 &&
    c.landArea != null
  ) {
    const pct = Math.abs(c.landArea - subject.landArea) / subject.landArea;
    s -= Math.min(15, Math.floor(pct * 10));
  }

  return Math.max(0, s);
}
