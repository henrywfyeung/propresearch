// src/agents/nodes/15_fetchZoning.ts — subject's residential zoning + planning
// overlays (VIC plan_zone/plan_overlay; NSW EPI Land Zoning). Open gov (§4.3).
// Fully graceful: failure → null planningControls; the graph continues.

import type { GraphState } from '@/agents/annotation';
import { fetchPlanningControls } from '@/tools/planning/zoning';

export async function fetchZoning(state: GraphState): Promise<Partial<GraphState>> {
  if (!state.resolvedAddress) {
    return { errors: [{ code: 'PARTIAL_DATA', message: 'fetchZoning: no resolvedAddress' }] };
  }
  const { lat, lng, state: region } = state.resolvedAddress;
  const planningControls = await fetchPlanningControls(lat, lng, region).catch(() => null);
  return { planningControls };
}
