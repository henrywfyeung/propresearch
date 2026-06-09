// src/agents/nodes/06_reasonAndSelect.ts — Node 06 keystone (CLAUDE.md §7.8),
// run as a 3-phase map-reduce to avoid one slow, stall-prone gpt-5.4 generation
// over all 30 comps:
//   1. PLAN    — triage ALL comps → {verdict, shortlist}  (Chat path; no stall)
//   2. ANALYSE — deep per-comp work on the shortlist, in parallel self-bounded
//                batches on the Responses path (the "map")
//   3. SELECT  — pick fair-value / anchor over the analysed pool (the "reduce")
// Each phase degrades gracefully (a failed plan → similarity shortlist; a failed
// analyse batch → those comps drop out; a failed select → deterministic pick),
// so a single stall can't abort the whole node. Downstream (triangulate bands /
// compose / render) is unchanged. Knobs are env-tunable for live tuning.

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import {
  type AnalysedComp,
  type ReasonSelectComp,
  type ReasonSubject,
  analyseVersion,
  buildAnalyseMessages,
  buildPlanMessages,
  buildSelectMessages,
  planVersion,
  selectVersion,
} from '@/prompts/reasonAndSelect';
import {
  type CompAnalysis,
  type CompPlan,
  type CompSelection,
  ReasonAnalysisOutputSchema,
  ReasonPlanOutputSchema,
  ReasonSelectionOutputSchema,
} from '@/schemas/reasonSelect';
import type { Comparable } from '@/schemas/state';
import { callWithFallback } from '@/tools/llm/structuredCall';
import pLimit from 'p-limit';

const num = (v: string | undefined, d: number) => Number(v) || d;
const model = () => process.env.OPENAI_MODEL_REASONING ?? '';

const BATCH_SIZE = () => num(process.env.REASON_BATCH_SIZE, 6);
const MAP_CONCURRENCY = () => num(process.env.REASON_MAP_CONCURRENCY, 4);
const MAP_EFFORT = () =>
  (process.env.REASON_MAP_EFFORT as 'low' | 'medium' | 'high' | undefined) ?? 'medium';
const MAP_TIMEOUT_MS = () => num(process.env.REASON_MAP_TIMEOUT_MS, 120_000);
const MAP_ATTEMPTS = () => num(process.env.REASON_MAP_ATTEMPTS, 2);
const SHORTLIST_TARGET = () => num(process.env.REASON_SHORTLIST, 12);
const MIN_SHORTLIST = 6; // below this, ignore the plan's shortlist and use similarity
const MIN_ANALYSED = 3; // partial-data floor

function toCompSummary(c: Comparable): ReasonSelectComp {
  return {
    id: c.id,
    address: c.address,
    salePrice: c.salePrice,
    contractDate: c.contractDate,
    distanceM: c.distanceM,
    beds: c.beds,
    baths: c.baths,
    landArea: c.landArea,
    propertyType: c.propertyType,
    similarityScore: c.similarityScore,
    layout: c.visionAnalysis?.layout ?? null,
    condition: c.visionAnalysis?.condition ?? null,
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Deterministic selection fallback when the reduce LLM call fails. */
function deterministicSelect(analysed: AnalysedComp[]): Map<string, CompSelection> {
  const eligible = analysed
    .filter((a) => !a.recommendExclude)
    .sort((a, b) => b.similarityScore - a.similarityScore);
  const out = new Map<string, CompSelection>();
  eligible.forEach((a, i) => {
    const selection = i < 5 ? 'fair-value' : i < 8 ? 'negotiation-anchor' : 'rejected';
    out.set(a.id, {
      compId: a.id,
      selection,
      rejectionReason: selection === 'rejected' ? 'Outside the top similarity-ranked set.' : null,
      selectionRationale: 'Selected deterministically by similarity (LLM selection unavailable).',
    });
  });
  for (const a of analysed)
    if (!out.has(a.id))
      out.set(a.id, {
        compId: a.id,
        selection: 'rejected',
        rejectionReason: 'Adjustments too large to rely on.',
        selectionRationale: 'Excluded deterministically (recommended exclude).',
      });
  return out;
}

export async function reasonAndSelect(state: GraphState): Promise<Partial<GraphState>> {
  const { subject, resolvedAddress, comparables } = state;
  if (!subject || comparables.length === 0) {
    return {
      errors: [
        { code: 'PARTIAL_DATA', message: 'reasonAndSelect: no subject or no candidate comps' },
      ],
    };
  }

  const reasonSubject: ReasonSubject = {
    suburb: resolvedAddress?.suburb ?? '',
    attrs: subject.attrs,
    layout: subject.visionAnalysis?.layout ?? null,
    condition: subject.visionAnalysis?.condition ?? null,
  };
  const compById = new Map(comparables.map((c) => [c.id, c]));

  // --- Phase 1: PLAN (triage all comps; Chat path, no reasoningEffort) -------
  const plans = new Map<string, CompPlan>();
  try {
    const out = await callWithFallback({
      model: model(),
      schema: ReasonPlanOutputSchema,
      node: 'reasonAndSelect:plan',
      promptVersion: planVersion,
      messages: buildPlanMessages(reasonSubject, comparables.map(toCompSummary)),
    });
    for (const p of out.plans) if (compById.has(p.compId)) plans.set(p.compId, p);
  } catch (err) {
    logger.warn(
      { err: String(err) },
      'reasonAndSelect: plan phase failed; using similarity-ranked shortlist',
    );
  }

  // Shortlist = plan's picks; if the plan gave too few (or failed), fall back to
  // the top-N comps by the deterministic similarityScore.
  let shortlist = comparables.filter((c) => plans.get(c.id)?.shortlist);
  if (shortlist.length < MIN_SHORTLIST) {
    shortlist = [...comparables]
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, SHORTLIST_TARGET());
  }

  // --- Phase 2: ANALYSE (the map; parallel self-bounded Responses batches) ----
  const batches = chunk(shortlist.map(toCompSummary), BATCH_SIZE());
  const limit = pLimit(MAP_CONCURRENCY());
  const batchResults = await Promise.all(
    batches.map((batch) =>
      limit(async (): Promise<CompAnalysis[]> => {
        try {
          const out = await callWithFallback({
            model: model(),
            reasoningEffort: MAP_EFFORT(),
            schema: ReasonAnalysisOutputSchema,
            node: 'reasonAndSelect:analyse',
            promptVersion: analyseVersion,
            messages: buildAnalyseMessages(reasonSubject, batch),
            reasoningTimeoutMs: MAP_TIMEOUT_MS(),
            reasoningMaxAttempts: MAP_ATTEMPTS(),
          });
          return out.analyses.filter((a) => compById.has(a.compId));
        } catch (err) {
          logger.warn(
            { err: String(err), batchIds: batch.map((b) => b.id) },
            'reasonAndSelect: analyse batch failed; degrading (those comps drop out)',
          );
          return [];
        }
      }),
    ),
  );
  const analyses = new Map<string, CompAnalysis>();
  for (const a of batchResults.flat()) analyses.set(a.compId, a);

  // Floor relative to the pool: a small pool needs only what it has; a full pool
  // must not proceed on a near-empty analysis (a hollow valuation).
  const floor = Math.min(MIN_ANALYSED, comparables.length);
  if (analyses.size < floor) {
    return {
      errors: [
        {
          code: 'PARTIAL_DATA',
          message: `reasonAndSelect: only ${analyses.size} comps analysed (need >= ${floor})`,
        },
      ],
    };
  }

  // --- Phase 3: SELECT (the reduce; Chat path over the analysed pool) ---------
  const analysed: AnalysedComp[] = [...analyses.values()].map((a) => {
    const c = compById.get(a.compId) as Comparable;
    return {
      id: a.compId,
      address: c.address,
      adjustedValue: a.adjustedValue,
      verdict: a.verdict,
      beds: c.beds,
      baths: c.baths,
      distanceM: c.distanceM,
      similarityScore: c.similarityScore,
      recommendExclude: a.recommendExclude,
    };
  });

  let selections: Map<string, CompSelection>;
  try {
    const out = await callWithFallback({
      model: model(),
      schema: ReasonSelectionOutputSchema,
      node: 'reasonAndSelect:select',
      promptVersion: selectVersion,
      messages: buildSelectMessages(reasonSubject, analysed),
    });
    selections = new Map(
      out.selections.filter((s) => analyses.has(s.compId)).map((s) => [s.compId, s]),
    );
    if (selections.size === 0) selections = deterministicSelect(analysed);
  } catch (err) {
    logger.warn({ err: String(err) }, 'reasonAndSelect: select phase failed; deterministic pick');
    selections = deterministicSelect(analysed);
  }

  // --- Merge plan + analyse + select back onto the comparables ---------------
  const now = new Date().toISOString();
  const updated: Comparable[] = comparables.map((c, i) => {
    const analysis = analyses.get(c.id);
    const verdict = analysis?.verdict ?? plans.get(c.id)?.verdict ?? c.verdict;
    // Only analysed comps can be selected; everything else is rejected.
    const selection = selections.get(c.id)?.selection ?? 'rejected';
    if (!analysis) return { ...c, verdict, selection };
    return {
      ...c,
      verdict,
      selection,
      comparison: analysis.comparison,
      adjustedValue: analysis.adjustedValue,
      adjustmentNarrative: analysis.adjustmentNarrative,
      adjustments: analysis.adjustments.map((a) => ({
        dimension: a.dimension,
        deltaPct: a.delta,
        rationale: a.rationale,
        sourceRef: [
          {
            provider: 'llm' as const,
            endpoint: 'node:reasonAndSelect',
            fetchedAt: now,
            path: `/comparables/${i}/salePrice`,
          },
        ],
      })),
    };
  });

  return { comparables: updated };
}
