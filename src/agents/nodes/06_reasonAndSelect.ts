// src/agents/nodes/06_reasonAndSelect.ts — Node 06 keystone (CLAUDE.md §7.8).
// Selects + adjusts the candidate comps via the LLM, merges decisions back onto
// state.comparables. LLM-unavailable propagates (retryable; not an in-band degrade).

import type { GraphState } from '@/agents/annotation';
import { type ReasonSelectComp, buildMessages, version } from '@/prompts/reasonAndSelect';
import { ReasonSelectOutputSchema } from '@/schemas/reasonSelect';
import type { Comparable } from '@/schemas/state';
import { callWithFallback } from '@/tools/llm/structuredCall';

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
  };
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

  const out = await callWithFallback({
    model: process.env.OPENAI_MODEL_REASONING ?? '',
    // 'low' (not the spec's 'high') because gpt-5.x reasons silently and the
    // OpenAI edge resets connections that send no response bytes within ~60s;
    // only low effort reliably emits its first token under that limit on Chat
    // Completions. High-effort reasoning needs the Responses API background
    // mode (follow-up). See structuredCall streaming note + scripts/probe-reason.
    reasoningEffort: 'low',
    schema: ReasonSelectOutputSchema,
    node: 'reasonAndSelect',
    promptVersion: version,
    messages: buildMessages({
      subject: { suburb: resolvedAddress?.suburb ?? '', attrs: subject.attrs },
      comps: comparables.map(toCompSummary),
    }),
  });

  const byId = new Map(out.decisions.map((d) => [d.compId, d]));
  const updated: Comparable[] = comparables.map((c, i) => {
    const d = byId.get(c.id);
    if (!d) return c;
    return {
      ...c,
      selection: d.selection,
      adjustedValue: d.adjustedValue,
      adjustmentNarrative: d.adjustmentNarrative,
      adjustments: d.adjustments.map((a) => ({
        dimension: a.dimension,
        deltaPct: a.delta,
        rationale: a.rationale,
        sourceRef: [
          {
            provider: 'llm' as const,
            endpoint: 'node:reasonAndSelect',
            fetchedAt: new Date().toISOString(),
            path: `/comparables/${i}/salePrice`,
          },
        ],
      })),
    };
  });

  return { comparables: updated };
}
