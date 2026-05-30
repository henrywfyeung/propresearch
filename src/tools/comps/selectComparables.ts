// src/tools/comps/selectComparables.ts
// Node 03 core logic (CLAUDE.md §7.3): subject + location -> scored, ranked
// candidate comp pool (top N, selection='candidate'). Pure async function —
// no graph, no LLM, no NSW VG. Fair-value/anchor tiering is Node 06 (LLM).

import type { Comparable } from '@/schemas/state';
import { fetchReaSoldComparables } from '@/tools/comps/reaComps';
import { type SimilaritySubject, similarityScore } from '@/tools/comps/similarity';
import { reaAutoComplete } from '@/tools/rapidapi/rea';

export interface SelectCompsInput {
  /** Subject attributes in the canonical vocab ('House' triggers the land-area term). */
  subject: SimilaritySubject;
  /** Subject coordinates (from resolvedAddress) for distance scoring. */
  geo: { lat: number; lng: number };
  /** Used to resolve the REA locationId. */
  location: { suburb: string; state: string; postcode: string };
}

export interface SelectCompsOpts {
  /** Candidate-pool cap (§7.3). Default 30. */
  maxCandidates?: number;
  /** Sold-within window in days (§7.3). Default 180. */
  withinDays?: number;
  /** Injectable clock for deterministic recency in tests. Default new Date(). */
  now?: Date;
}

const MS_PER_WEEK = 7 * 86_400_000;

/**
 * Resolve a REA locationId for the suburb. Prefers reaAutoComplete's canonical
 * id; if it returns no matches, builds the observed `suburb:<Suburb>, <STATE> <PC>`
 * form. A thrown error (REA down / schema drift) propagates to the caller.
 */
async function resolveLocationId(location: SelectCompsInput['location']): Promise<string> {
  const fallback = `suburb:${location.suburb}, ${location.state} ${location.postcode}`;
  const locs = await reaAutoComplete(`${location.suburb} ${location.state}`);
  if (locs.length === 0) return fallback;
  const match = locs.find((l) => l.type === 'suburb') ?? locs[0];
  return match?.locationId ?? fallback;
}

/**
 * Node 03's deterministic comp selection: resolve the suburb, fetch recent sold
 * comps from REA, score each by similarity, rank descending (tie-break: nearer
 * first), and keep the top `maxCandidates`. Every entry stays `selection:
 * 'candidate'` — tiering is Node 06. Returns [] when REA yields no usable comps.
 */
export async function selectComparables(
  input: SelectCompsInput,
  opts: SelectCompsOpts = {},
): Promise<Comparable[]> {
  const { maxCandidates = 30, withinDays = 180, now = new Date() } = opts;

  const locationId = await resolveLocationId(input.location);
  const candidates = await fetchReaSoldComparables({
    locationId,
    subject: input.geo,
    withinDays,
  });

  const scored = candidates.map((c) => {
    const weeksSinceSale = Math.max(0, (now.getTime() - Date.parse(c.contractDate)) / MS_PER_WEEK);
    return {
      ...c,
      similarityScore: similarityScore(input.subject, {
        beds: c.beds,
        baths: c.baths,
        landArea: c.landArea,
        propertyType: c.propertyType,
        weeksSinceSale,
        distanceM: c.distanceM,
      }),
    };
  });

  scored.sort((a, b) => b.similarityScore - a.similarityScore || a.distanceM - b.distanceM);
  return scored.slice(0, maxCandidates);
}
