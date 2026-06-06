// src/agents/nodes/03_fetchCandidateComps.ts — Node 03 (CLAUDE.md §7.3).
// Reads seeded resolvedAddress + subject, runs selectComparables, degrades
// in-band (§7.17). Never throws.

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import { selectComparables } from '@/tools/comps/selectComparables';

// Normalise a street address ("<number> <street> <type>") for self-comp dedupe,
// canonicalising common street-type suffixes (Street/St, Road/Rd, …) so a
// user-typed subject matches REA's formatting of its own prior sale.
const STREET_TYPES: Array<[RegExp, string]> = [
  [/\b(street|st)\b/g, 'st'],
  [/\b(road|rd)\b/g, 'rd'],
  [/\b(avenue|ave|av)\b/g, 'ave'],
  [/\b(parade|pde)\b/g, 'pde'],
  [/\b(place|pl)\b/g, 'pl'],
  [/\b(crescent|cres)\b/g, 'cres'],
  [/\b(terrace|tce)\b/g, 'tce'],
  [/\b(drive|dr)\b/g, 'dr'],
  [/\b(court|ct)\b/g, 'ct'],
  [/\b(lane|ln)\b/g, 'ln'],
];
export function normalizeStreet(addr: string): string {
  let s = (addr.split(',')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [re, to] of STREET_TYPES) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim();
}

export async function fetchCandidateComps(state: GraphState): Promise<Partial<GraphState>> {
  const { resolvedAddress, subject } = state;
  if (!resolvedAddress || !subject) {
    return {
      errors: [
        {
          code: 'PARTIAL_DATA',
          message: 'fetchCandidateComps: missing resolvedAddress or subject',
        },
      ],
    };
  }

  try {
    const all = await selectComparables({
      subject: {
        beds: subject.attrs.beds,
        baths: subject.attrs.baths,
        landArea: subject.attrs.landArea,
        propertyType: subject.attrs.propertyType,
      },
      geo: { lat: resolvedAddress.lat, lng: resolvedAddress.lng },
      location: {
        suburb: resolvedAddress.suburb,
        state: resolvedAddress.state,
        postcode: resolvedAddress.postcode,
      },
    });

    // Drop the subject's own address — its prior sale can surface in the sold
    // pool and the LLM would otherwise "compare the property to itself".
    const subjectStreet = normalizeStreet(state.rawAddress || resolvedAddress.normalizedAddress);
    const comparables = all.filter((c) => normalizeStreet(c.address) !== subjectStreet);
    if (comparables.length < all.length) {
      logger.info(
        { removed: all.length - comparables.length, subjectStreet },
        'fetchCandidateComps: dropped subject self-comp from pool',
      );
    }
    return { comparables };
  } catch (err) {
    logger.warn({ err }, 'fetchCandidateComps: REA comp fetch failed; degrading to empty pool');
    return {
      comparables: [],
      errors: [{ code: 'PARTIAL_DATA', message: `fetchCandidateComps: ${(err as Error).message}` }],
    };
  }
}
