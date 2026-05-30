// src/agents/annotation.ts — minimal LangGraph state (CLAUDE.md §6.1), grown per
// node. Reuses the reducers in state.ts: comparables merge-by-key on `id`,
// errors append, singletons last-value.

import { appendReducer, mergeByKey } from '@/agents/state';
import type { Comparable, ResolvedAddress, SubjectProperty } from '@/schemas/state';
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
  errors: Annotation<{ code: string; message: string }[]>({
    reducer: appendReducer,
    default: () => [],
  }),
});

export type GraphState = typeof GraphAnnotation.State;
