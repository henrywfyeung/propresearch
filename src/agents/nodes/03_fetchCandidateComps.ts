// src/agents/nodes/03_fetchCandidateComps.ts — Node 03 (CLAUDE.md §7.3).
// Reads seeded resolvedAddress + subject, runs selectComparables, degrades
// in-band (§7.17). Never throws.

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import { selectComparables } from '@/tools/comps/selectComparables';

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
    const comparables = await selectComparables({
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
    return { comparables };
  } catch (err) {
    logger.warn({ err }, 'fetchCandidateComps: REA comp fetch failed; degrading to empty pool');
    return {
      comparables: [],
      errors: [{ code: 'PARTIAL_DATA', message: `fetchCandidateComps: ${(err as Error).message}` }],
    };
  }
}
