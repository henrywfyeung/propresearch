// src/agents/nodes/16_fetchProximity.ts — proximity to transmission lines (GA) +
// freeways (OSM). National (no state gate). Graceful: failure → null; graph continues.

import type { GraphState } from '@/agents/annotation';
import { fetchProximityHazards } from '@/tools/proximity/proximity';

export async function fetchProximity(state: GraphState): Promise<Partial<GraphState>> {
  if (!state.resolvedAddress) {
    return { errors: [{ code: 'PARTIAL_DATA', message: 'fetchProximity: no resolvedAddress' }] };
  }
  const { lat, lng } = state.resolvedAddress;
  const proximityHazards = await fetchProximityHazards({ lat, lng }).catch(() => null);
  return { proximityHazards };
}
