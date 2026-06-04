// src/agents/nodes/04b_visionAnalyseComps.ts — Node 04b (CLAUDE.md §7.5).
// GPT-5 vision over each candidate comp's listing photos → CompVision
// (condition + presentation + red flags + a light layout block). Runs BEFORE
// reasonAndSelect so every comp's verdict + Size/Layout/Condition comparison is
// vision-grounded, including the inferior/superior comps plotted on the banded
// chart.
//
// - Fan-out with p-limit(6); ~5s per comp, ~25-30s for 30 comps (§7.5).
// - Graceful: a per-comp failure (or a comp with no photos) leaves that comp's
//   visionAnalysis null and the node continues — never aborts.
// - Idempotent in-memory: comps that already carry a visionAnalysis are skipped
//   (no double charge on a retry within the same run). Durable per-item
//   resumption (report_node_artifacts, [R21]) is deferred until the Inngest
//   queue lands — same posture as fetchRisks (§7.11).
// - Returns the full comparables array; the merge-by-key('id') reducer folds it
//   back idempotently.

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import type { Comparable } from '@/schemas/state';
import { CompVisionSchema } from '@/schemas/vision';
import { callWithFallback } from '@/tools/llm/structuredCall';
import type { ContentPart, LlmMessage } from '@/tools/llm/types';
import pLimit from 'p-limit';

const MAX_COMP_PHOTOS = 6; // photos sent to vision per comp
const CONCURRENCY = 6; // parallel comp-vision calls (§7.5)

const SYSTEM_TEXT =
  "You are a property analyst reviewing a comparable sale's listing photos. " +
  'Assess the overall condition, notable presentation factors, and any visible red flags. ' +
  'Also capture a light LAYOUT read into the "layout" object: ' +
  'storeys (single/double/split-level/multi); ' +
  'structure (free-standing = no shared walls; semi-detached = one shared wall; terraced = shared both sides; attached-unit = a unit/apartment within a larger building); ' +
  'era (period-pre-1945 / mid-century / late-20th-century / contemporary / new-build — judge by architectural style, do NOT guess an exact year). ' +
  'Use "unknown" wherever these limited listing photos do not clearly show an attribute. Be conservative; do not use marketing language.';

const USER_TEXT =
  "Inspect this comparable sale's listing photos and return a structured visual assessment.";

function buildMessages(photoUrls: string[]): LlmMessage[] {
  const imageParts: ContentPart[] = photoUrls.map((url) => ({
    type: 'image_url',
    image_url: { url },
  }));
  return [
    { role: 'system', content: SYSTEM_TEXT },
    { role: 'user', content: [{ type: 'text', text: USER_TEXT }, ...imageParts] },
  ];
}

export async function visionAnalyseComps(state: GraphState): Promise<Partial<GraphState>> {
  const comps = state.comparables;
  if (comps.length === 0) return {};

  // Vision uses the non-reasoning path (Chat Completions / function calling).
  const model = process.env.OPENAI_MODEL_VISION || process.env.OPENAI_MODEL_REASONING || '';
  const limit = pLimit(CONCURRENCY);

  const updated = await Promise.all(
    comps.map((c) =>
      limit(async (): Promise<Comparable> => {
        // Idempotency: skip comps already analysed (e.g. on a retry).
        if (c.visionAnalysis) return c;
        const photos = (c.photos ?? []).slice(0, MAX_COMP_PHOTOS);
        if (photos.length === 0) return c;

        try {
          const visionAnalysis = await callWithFallback({
            model,
            schema: CompVisionSchema,
            node: 'visionComps',
            messages: buildMessages(photos),
          });
          return { ...c, visionAnalysis };
        } catch (err) {
          logger.warn(
            { err: String(err), compId: c.id },
            'visionAnalyseComps: per-comp vision failed — continuing without it',
          );
          return c;
        }
      }),
    ),
  );

  return { comparables: updated };
}
