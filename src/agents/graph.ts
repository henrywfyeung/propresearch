// src/agents/graph.ts — the report graph. This increment:
// START → resolveAddress → fetchCandidateComps → reasonAndSelect → END,
// compiled in-memory (no checkpointer; PostgresSaver lands with Inngest). Grows
// as nodes are added.

import { GraphAnnotation, type GraphState } from '@/agents/annotation';
import { resolveAddress } from '@/agents/nodes/01_resolveAddress';
import { fetchCandidateComps } from '@/agents/nodes/03_fetchCandidateComps';
import { reasonAndSelect } from '@/agents/nodes/06_reasonAndSelect';
import { runWithReportContext } from '@/agents/reportContext';
import { END, START, StateGraph } from '@langchain/langgraph';

export const reportGraph = new StateGraph(GraphAnnotation)
  .addNode('resolveAddress', resolveAddress)
  .addNode('fetchCandidateComps', fetchCandidateComps)
  .addNode('reasonAndSelect', reasonAndSelect)
  .addEdge(START, 'resolveAddress')
  .addEdge('resolveAddress', 'fetchCandidateComps')
  .addEdge('fetchCandidateComps', 'reasonAndSelect')
  .addEdge('reasonAndSelect', END)
  .compile();

/**
 * Invoke the graph with a per-report context so the RapidAPI per-report quota
 * (rapidApiCall → reportCtx) is enforced. `input` seeds the graph's initial state.
 */
export async function runGraph(input: Partial<GraphState>): Promise<GraphState> {
  const reportId = input.reportId ?? 'adhoc';
  return runWithReportContext({ reportId }, () => reportGraph.invoke(input));
}
