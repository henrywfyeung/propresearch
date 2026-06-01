// src/agents/nodes/14_fetchSchools.ts — nearby schools + early-education facilities
// from Geoscience Australia's national open dataset (§4.3). National (no state gate).
// Fully graceful: any failure degrades to an empty list; the graph continues.

import type { GraphState } from '@/agents/annotation';
import { fetchNearbyFacilities } from '@/tools/schools/ga';

const RADIUS_M = 2000;

export async function fetchSchools(state: GraphState): Promise<Partial<GraphState>> {
  if (!state.resolvedAddress) {
    return { errors: [{ code: 'PARTIAL_DATA', message: 'fetchSchools: no resolvedAddress' }] };
  }
  const { lat, lng } = state.resolvedAddress;
  const schools = await fetchNearbyFacilities({ lat, lng }, RADIUS_M).catch(() => []);
  return { schools };
}
