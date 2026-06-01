// src/agents/nodes/04a_visionAnalyseSubject.ts — Node 04a (CLAUDE.md §7.4).
// GPT-5.4 vision over user-supplied listing photos → structured SubjectVision.
//
// - No subject → in-band PARTIAL_DATA error (mirrors node 09/12 style).
// - No photos (subject.photos is empty) → return {} gracefully (vision is optional, §7.17).
// - Up to 8 photos sent as image_url parts in a multimodal HumanMessage.
// - Calls callWithFallback on the NON-reasoning path (no reasoningEffort).
// - Any LLM failure is caught and swallowed → return {} (graceful; non-fatal).

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import { SubjectVisionSchema } from '@/schemas/vision';
import { callWithFallback } from '@/tools/llm/structuredCall';
import type { ContentPart, LlmMessage } from '@/tools/llm/types';

const MAX_PHOTOS = 8;

const SYSTEM_TEXT =
  'You are a qualified building inspector and property analyst reviewing residential listing photos. ' +
  'Assess the overall condition, staging/presentation quality, notable presentation factors, and any visible red flags. ' +
  'Write a specific, conservative inspector-style comment — do not use marketing language. ' +
  'If any images appear to be placeholders, blurred, or unclear, note this and remain conservative in your assessment.';

const USER_TEXT =
  'Please inspect the following listing photos and return a structured visual assessment.';

export async function visionAnalyseSubject(state: GraphState): Promise<Partial<GraphState>> {
  // Guard: no subject in state
  if (!state.subject) {
    return {
      errors: [{ code: 'PARTIAL_DATA', message: 'visionAnalyseSubject: no subject in state' }],
    };
  }

  const { photos } = state.subject;

  // Nothing to analyse — not an error, just skip
  if (photos.length === 0) {
    return {};
  }

  // Build multimodal message: text instruction + one image_url per photo (capped at 8)
  const imageParts: ContentPart[] = photos.slice(0, MAX_PHOTOS).map((url) => ({
    type: 'image_url',
    image_url: { url },
  }));

  const messages: LlmMessage[] = [
    { role: 'system', content: SYSTEM_TEXT },
    {
      role: 'user',
      content: [{ type: 'text', text: USER_TEXT }, ...imageParts],
    },
  ];

  // Use || (falsy) so that an empty string env var falls through to the next option.
  const model = process.env.OPENAI_MODEL_VISION || process.env.OPENAI_MODEL_REASONING || '';

  try {
    const visionAnalysis = await callWithFallback({
      model,
      schema: SubjectVisionSchema,
      node: 'visionSubject',
      messages,
      // NO reasoningEffort — vision uses the functionCalling / Chat Completions path
    });

    return {
      subject: {
        ...state.subject,
        visionAnalysis,
      },
    };
  } catch (err) {
    logger.warn({ err: String(err) }, 'visionAnalyseSubject: LLM call failed — skipping vision');
    return {};
  }
}
