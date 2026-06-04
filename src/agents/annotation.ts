// src/agents/annotation.ts — minimal LangGraph state (CLAUDE.md §6.1), grown per
// node. Reuses the reducers in state.ts: comparables merge-by-key on `id`,
// errors append, singletons last-value.

import { appendReducer, mergeByKey } from '@/agents/state';
import type { ReportProse } from '@/schemas/claims';
import type {
  Comparable,
  MarketContext,
  ResolvedAddress,
  RiskFlag,
  SubjectProperty,
  SuburbDemographics,
  TriangulatedValue,
} from '@/schemas/state';
import type { PlanningControls } from '@/tools/planning/zoning';
import type { ProximityHazards } from '@/tools/proximity/proximity';
import type { NearbyFacility, NearbyPlace } from '@/tools/schools/ga';
import { Annotation } from '@langchain/langgraph';

export const GraphAnnotation = Annotation.Root({
  reportId: Annotation<string>(),
  rawAddress: Annotation<string>(),
  resolvedAddress: Annotation<ResolvedAddress | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  subject: Annotation<SubjectProperty | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  comparables: Annotation<Comparable[]>({
    reducer: mergeByKey<Comparable>('id'),
    default: () => [],
  }),
  risks: Annotation<RiskFlag[]>({
    reducer: mergeByKey<RiskFlag>('category'),
    default: () => [],
  }),
  triangulation: Annotation<TriangulatedValue | null>({
    reducer: (_c, u) => u,
    default: () => null,
  }),
  market: Annotation<MarketContext | null>({
    reducer: (_c, u) => u,
    default: () => null,
  }),
  demographics: Annotation<SuburbDemographics | null>({
    reducer: (_c, u) => u,
    default: () => null,
  }),
  schools: Annotation<NearbyFacility[]>({
    reducer: (_c, u) => u,
    default: () => [],
  }),
  hospitals: Annotation<NearbyPlace[]>({
    reducer: (_c, u) => u,
    default: () => [],
  }),
  planningControls: Annotation<PlanningControls | null>({
    reducer: (_c, u) => u,
    default: () => null,
  }),
  proximityHazards: Annotation<ProximityHazards | null>({
    reducer: (_c, u) => u,
    default: () => null,
  }),
  prose: Annotation<ReportProse>({
    reducer: (cur, inc) => ({ ...cur, ...inc }),
    default: () => ({}),
  }),
  errors: Annotation<{ code: string; message: string }[]>({
    reducer: appendReducer,
    default: () => [],
  }),
  pdfUrl: Annotation<string | null>({ reducer: (_c, u) => u, default: () => null }),
});

export type GraphState = typeof GraphAnnotation.State;
