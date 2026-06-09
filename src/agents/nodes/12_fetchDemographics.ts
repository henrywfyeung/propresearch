// src/agents/nodes/12_fetchDemographics.ts — Node fetchDemographics (spec §4).
// Resolves the property's SA2 via the ABS ArcGIS endpoint then fetches Census 2021
// demographics. Fully graceful: any failure degrades to null demographics; the
// graph continues without it.  National (ABS is Australia-wide — no state gate).

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import { fetchCensusDemographics } from '@/tools/abs/census';
import { resolveSa2 } from '@/tools/abs/sa2';

export async function fetchDemographics(state: GraphState): Promise<Partial<GraphState>> {
  // Guard: no resolvedAddress — in-band PARTIAL_DATA (mirrors node 09)
  if (!state.resolvedAddress) {
    return {
      errors: [{ code: 'PARTIAL_DATA', message: 'fetchDemographics: no resolvedAddress' }],
    };
  }

  const { lat, lng } = state.resolvedAddress;

  // Step 1 — point → SA2
  const sa2 = await resolveSa2(lat, lng).catch(() => null);
  if (!sa2) {
    logger.warn(
      { lat, lng },
      'fetchDemographics: SA2 resolution returned null — skipping demographics',
    );
    return { demographics: null };
  }

  // Step 2 — SA2 → Census demographics (never throws)
  const census = await fetchCensusDemographics(sa2.sa2Code).catch(() => ({}));

  return {
    demographics: {
      sa2Code: sa2.sa2Code,
      sa2Name: sa2.sa2Name,
      censusYear: 2021,
      population: null,
      medianAge: null,
      medianHouseholdIncomeWeekly: null,
      medianPersonalIncomeWeekly: null,
      medianRentWeekly: null,
      medianMortgageMonthly: null,
      avgHouseholdSize: null,
      ownerOccupiedPct: null,
      rentedPct: null,
      ownedWithMortgagePct: null,
      socialHousingPct: null,
      seifaIrsadDecile: null,
      seifaIrsadScore: null,
      ...census,
    },
  };
}
