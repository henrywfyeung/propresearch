// src/agents/graph.ts — the report graph. This increment:
// START → resolveAddress → fetchCandidateComps → reasonAndSelect → triangulate → compose → render → END,
// compiled in-memory (no checkpointer; PostgresSaver lands with Inngest). Grows
// as nodes are added.

import { GraphAnnotation, type GraphState } from '@/agents/annotation';
import { resolveAddress } from '@/agents/nodes/01_resolveAddress';
import { fetchCandidateComps } from '@/agents/nodes/03_fetchCandidateComps';
import { visionAnalyseSubject } from '@/agents/nodes/04a_visionAnalyseSubject';
import { visionAnalyseComps } from '@/agents/nodes/04b_visionAnalyseComps';
import { fetchPlanning } from '@/agents/nodes/05_planningAndNews';
import { reasonAndSelect } from '@/agents/nodes/06_reasonAndSelect';
import { triangulate } from '@/agents/nodes/07_triangulate';
import { fetchRisks } from '@/agents/nodes/09_fetchRisks';
import { compose } from '@/agents/nodes/10_compose';
import { fetchDemographics } from '@/agents/nodes/12_fetchDemographics';
import { render } from '@/agents/nodes/13_render';
import { fetchSchools } from '@/agents/nodes/14_fetchSchools';
import { fetchZoning } from '@/agents/nodes/15_fetchZoning';
import { fetchProximity } from '@/agents/nodes/16_fetchProximity';
import { runWithReportContext } from '@/agents/reportContext';
import { END, START, StateGraph } from '@langchain/langgraph';

// Graph topology (spec §5 / CLAUDE.md §6.2):
//
//   START → resolveAddress ─┬→ fetchCandidateComps → visionComps → reasonAndSelect → triangulate ─┐
//                           ├→ visionSubject ────────────────────────────────────────┤
//                           ├→ fetchRisks ──────────────────────────────────────────┤
//                           ├→ fetchPlanning ────────────────────────────────────────┤
//                           └→ fetchDemographics ─────────────────────────────────────┴→ compose → render → END

export const reportGraph = new StateGraph(GraphAnnotation)
  .addNode('resolveAddress', resolveAddress)
  .addNode('fetchCandidateComps', fetchCandidateComps)
  .addNode('visionComps', visionAnalyseComps)
  .addNode('visionSubject', visionAnalyseSubject)
  .addNode('fetchPlanning', fetchPlanning)
  .addNode('fetchRisks', fetchRisks)
  .addNode('fetchDemographics', fetchDemographics)
  .addNode('fetchSchools', fetchSchools)
  .addNode('fetchZoning', fetchZoning)
  .addNode('fetchProximity', fetchProximity)
  .addNode('reasonAndSelect', reasonAndSelect)
  .addNode('triangulate', triangulate)
  .addNode('compose', compose)
  .addNode('render', render)
  .addEdge(START, 'resolveAddress')
  // parallel branches from resolveAddress
  .addEdge('resolveAddress', 'fetchCandidateComps')
  .addEdge('resolveAddress', 'visionSubject')
  .addEdge('resolveAddress', 'fetchRisks')
  .addEdge('resolveAddress', 'fetchPlanning')
  .addEdge('resolveAddress', 'fetchDemographics')
  .addEdge('resolveAddress', 'fetchSchools')
  .addEdge('resolveAddress', 'fetchZoning')
  .addEdge('resolveAddress', 'fetchProximity')
  // comp vision runs after the candidate pool is built, before selection so the
  // verdicts + Size/Layout/Condition comparison are vision-grounded
  .addEdge('fetchCandidateComps', 'visionComps')
  .addEdge('visionComps', 'reasonAndSelect')
  .addEdge('reasonAndSelect', 'triangulate')
  // compose waits for triangulate, visionSubject, fetchRisks, fetchPlanning,
  // fetchDemographics, fetchSchools, fetchZoning AND fetchProximity (8-way join)
  .addEdge(
    [
      'triangulate',
      'visionSubject',
      'fetchRisks',
      'fetchPlanning',
      'fetchDemographics',
      'fetchSchools',
      'fetchZoning',
      'fetchProximity',
    ],
    'compose',
  )
  .addEdge('compose', 'render')
  .addEdge('render', END)
  .compile();

export interface RunGraphOpts {
  /** Called after each node completes, with the node name. */
  onNode?: (node: string) => void | Promise<void>;
}

/**
 * Run the graph with a per-report context so the RapidAPI per-report quota
 * (rapidApiCall → reportCtx) is enforced. `input` seeds the graph's initial state.
 *
 * When `opts.onNode` is provided the graph runs in streaming mode so each
 * completed node triggers the callback; the return value is identical to the
 * non-streaming `invoke` path.  When `onNode` is omitted the behaviour is
 * identical to the previous `reportGraph.invoke(input)` call.
 */
export async function runGraph(
  input: Partial<GraphState>,
  opts?: RunGraphOpts,
): Promise<GraphState> {
  const reportId = input.reportId ?? 'adhoc';

  if (!opts?.onNode) {
    // Fast path — no streaming overhead when no callback is registered.
    return runWithReportContext({ reportId }, () => reportGraph.invoke(input));
  }

  // Capture `onNode` in a local so TypeScript doesn't lose the non-undefined
  // narrowing across the async closure boundary.
  const onNode = opts.onNode;

  return runWithReportContext({ reportId }, async () => {
    const stream = await reportGraph.stream(input, {
      streamMode: ['values', 'updates'],
    });

    let finalState: GraphState | undefined;

    for await (const chunk of stream) {
      // Multi-mode streaming yields [mode, payload] tuples.
      const [mode, payload] = chunk as [string, unknown];

      if (mode === 'updates' && payload !== null && typeof payload === 'object') {
        const node = Object.keys(payload as object)[0];
        // `__metadata__` appears alongside the node key only on checkpointed-task
        // replays (no checkpointer today, but guard it so a future PostgresSaver
        // doesn't write currentNode='__metadata__'). [review]
        if (node && node !== '__metadata__') await onNode(node);
      } else if (mode === 'values') {
        finalState = payload as GraphState;
      }
    }

    if (!finalState) throw new Error('runGraph: stream produced no final state');
    return finalState;
  });
}
