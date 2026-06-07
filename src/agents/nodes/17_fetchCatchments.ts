// src/agents/nodes/17_fetchCatchments.ts — which government primary + secondary
// school the subject address is ZONED for (its catchment / intake zone). Distinct
// from Node 14's nearby-schools proximity list: catchment = entitlement, which is
// what actually drives price for buyers. Point-in-polygon against bundled CC BY
// GeoJSON (see src/tools/schools/catchments.ts) — no LLM, no network, $0.
//
// Parallel branch off resolveAddress. Fully graceful: non-NSW/VIC or no enclosing
// zone yields nulls and the report renders without the catchment block.

import type { GraphState } from '@/agents/annotation';
import { findCatchments } from '@/tools/schools/catchments';

export async function fetchCatchments(state: GraphState): Promise<Partial<GraphState>> {
  const a = state.resolvedAddress;
  if (!a) return {};
  return { catchments: findCatchments(a.lat, a.lng, a.state) };
}
