// src/agents/graph.ts — the report graph. This increment:
// START → resolveAddress → fetchCandidateComps → reasonAndSelect → triangulate → compose → render → END,
// compiled in-memory (no checkpointer; PostgresSaver lands with Inngest). Grows
// as nodes are added.

import { GraphAnnotation, type GraphState } from '@/agents/annotation';
import { resolveAddress } from '@/agents/nodes/01_resolveAddress';
import { fetchCandidateComps } from '@/agents/nodes/03_fetchCandidateComps';
import { reasonAndSelect } from '@/agents/nodes/06_reasonAndSelect';
import { triangulate } from '@/agents/nodes/07_triangulate';
import { compose } from '@/agents/nodes/10_compose';
import { render } from '@/agents/nodes/13_render';
import { runWithReportContext } from '@/agents/reportContext';
import { END, START, StateGraph } from '@langchain/langgraph';

export const reportGraph = new StateGraph(GraphAnnotation)
  .addNode('resolveAddress', resolveAddress)
  .addNode('fetchCandidateComps', fetchCandidateComps)
  .addNode('reasonAndSelect', reasonAndSelect)
  .addNode('triangulate', triangulate)
  .addNode('compose', compose)
  .addNode('render', render)
  .addEdge(START, 'resolveAddress')
  .addEdge('resolveAddress', 'fetchCandidateComps')
  .addEdge('fetchCandidateComps', 'reasonAndSelect')
  .addEdge('reasonAndSelect', 'triangulate')
  .addEdge('triangulate', 'compose')
  .addEdge('compose', 'render')
  .addEdge('render', END)
  .compile();

/**
 * Invoke the graph with a per-report context so the RapidAPI per-report quota
 * (rapidApiCall → reportCtx) is enforced. `input` seeds the graph's initial state.
 */
export async function runGraph(input: Partial<GraphState>): Promise<GraphState> {
  const reportId = input.reportId ?? 'adhoc';
  return runWithReportContext({ reportId }, () => reportGraph.invoke(input));
}
