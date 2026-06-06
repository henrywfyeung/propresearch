// src/agents/nodes/10_compose.ts — Node 10 (CLAUDE.md §7.12, v0). Writes the four
// core sections in parallel as text-block narrative; stamps the valuation range
// claim deterministically from state.triangulation.

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import { type ComposeInput, type ComposeSection, buildMessages, version } from '@/prompts/compose';
import type { ClaimBlock, ReportProse } from '@/schemas/claims';
import type { Comparable } from '@/schemas/state';
import { callWithFallback } from '@/tools/llm/structuredCall';
import { computeSuburbStats } from '@/tools/market/suburbStats';
import { z } from 'zod';

const SECTIONS: ComposeSection[] = [
  'summary',
  'subject',
  'valuation',
  'comparables',
  'market',
  'risks',
  'planning',
];
// Wrapped in an object: OpenAI structured output requires the root schema to be
// an object, not a top-level array (the 'extract' function rejects array roots).
const TextBlocksSchema = z.object({
  blocks: z.array(z.object({ type: z.literal('text'), text: z.string().min(1) })),
});

function toCompSummary(c: Comparable): ComposeInput['selectedComps'][number] {
  return {
    id: c.id,
    address: c.address,
    salePrice: c.salePrice,
    adjustedValue: c.adjustedValue,
    contractDate: c.contractDate,
    beds: c.beds,
    baths: c.baths,
    propertyType: c.propertyType,
    selection: c.selection,
    verdict: c.verdict,
    comparison: c.comparison,
  };
}

export async function compose(state: GraphState): Promise<Partial<GraphState>> {
  const { subject, resolvedAddress, comparables, triangulation } = state;
  if (!subject) {
    return { errors: [{ code: 'PARTIAL_DATA', message: 'compose: no subject' }] };
  }

  const input: ComposeInput = {
    suburb: resolvedAddress?.suburb ?? '',
    subjectAttrs: subject.attrs,
    triangulation,
    selectedComps: comparables
      .filter((c) => c.selection === 'fair-value' || c.selection === 'negotiation-anchor')
      .map(toCompSummary),
    risks: state.risks ?? [],
    recentDAs: state.market?.recentDAs ?? [],
    suburbStats: computeSuburbStats(comparables),
    demographics: state.demographics ?? null,
  };

  // Planning (DA) coverage is NSW-only (Node 05). For other regions the empty
  // DA list means "not queried", NOT "no activity" — so emit an honest note
  // deterministically rather than letting the LLM infer a "stable area" from it.
  const planningAvailable = resolvedAddress?.state === 'NSW';

  const entries = await Promise.all(
    SECTIONS.map(async (section): Promise<[ComposeSection, ClaimBlock[]]> => {
      if (section === 'planning' && !planningAvailable) {
        const region = resolvedAddress?.state ?? 'this region';
        return [
          section,
          [
            {
              type: 'text',
              text: `Development-application data is not available for ${region} properties in this version — planning-activity coverage is currently limited to NSW. The absence of listed applications here reflects that coverage gap, not evidence of low development activity nearby; check the local council or planning authority directly.`,
            },
          ],
        ];
      }
      // Graceful per-section: a transient LLM failure on one section must not
      // abort the whole report (the 7 calls run in parallel; without this a
      // single OpenAI hiccup + unconfigured fallback kills everything). Degrade
      // that one section to a short note and carry on, like fetchRisks/Node 06.
      try {
        const out = await callWithFallback({
          model: process.env.OPENAI_MODEL_COMPOSE ?? '',
          schema: TextBlocksSchema,
          node: `compose:${section}`,
          promptVersion: version,
          messages: buildMessages(section, input),
        });
        return [section, out.blocks];
      } catch (err) {
        logger.warn({ err: String(err), section }, 'compose: section failed; using placeholder');
        return [
          section,
          [
            {
              type: 'text',
              text: 'This section could not be generated due to a temporary issue and has been left brief; the structured figures elsewhere in the report are unaffected.',
            },
          ],
        ];
      }
    }),
  );

  const prose = Object.fromEntries(entries) as ReportProse;

  if (triangulation) {
    prose.valuation = [
      {
        type: 'range',
        text: 'Estimated value {{lo}}-{{hi}}',
        low: triangulation.low,
        high: triangulation.high,
        format: 'currency-aud',
        sourceRef: {
          provider: 'derived',
          endpoint: 'node:triangulate',
          fetchedAt: new Date().toISOString(),
          path: '/triangulation/reconciled',
        },
      },
      ...(prose.valuation ?? []),
    ];
  }

  return { prose };
}
