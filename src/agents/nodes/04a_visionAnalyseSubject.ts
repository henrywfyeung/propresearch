// src/agents/nodes/04a_visionAnalyseSubject.ts — Node 04a (CLAUDE.md §7.4).
// GPT-5.4 vision over listing photos → structured SubjectVision.
//
// Photo sources (merged, de-duplicated, listing-first):
//   1. Auto-fetched REA CDN photos + floor plans via fetchListingMedia.
//   2. User-supplied extras (state.subject.photos), e.g. inspection shots.
//
// - No subject → in-band PARTIAL_DATA error (mirrors node 09/12 style).
// - photos written to state regardless of whether vision succeeds (so the
//   render's photo grid shows even if the LLM call fails).
// - No photos after merge → return early with empty photos + null visionAnalysis.
// - Up to 8 photos sent as image_url parts in a multimodal HumanMessage.
// - Calls callWithFallback on the NON-reasoning path (no reasoningEffort).
// - Any LLM failure is caught → photos still written, visionAnalysis null (graceful).

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import { SubjectVisionSchema } from '@/schemas/vision';
import { callWithFallback } from '@/tools/llm/structuredCall';
import type { ContentPart, LlmMessage } from '@/tools/llm/types';
import { fetchListingMedia } from '@/tools/rapidapi/listingMedia';

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

  // Determine the lookup address: prefer rawAddress (REA-friendly user input),
  // fall back to resolvedAddress.normalizedAddress.
  const lookupAddress =
    state.rawAddress?.trim() || state.resolvedAddress?.normalizedAddress || null;

  // Auto-fetch listing media — swallow all errors (graceful degradation).
  const media = lookupAddress ? await fetchListingMedia(lookupAddress).catch(() => null) : null;

  // Merge: listing photos first, then floor plans, then user-supplied extras.
  // De-duplicate by URL so re-runs don't double-up.
  const photos = [
    ...new Set([
      ...(media?.photos ?? []),
      ...(media?.floorplans ?? []),
      ...(state.subject.photos ?? []),
    ]),
  ];

  // Nothing to show or analyse — return early with photos written (empty array).
  if (photos.length === 0) {
    return {
      subject: {
        ...state.subject,
        photos: [],
        visionAnalysis: null,
      },
    };
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

  let visionAnalysis = null;
  try {
    visionAnalysis = await callWithFallback({
      model,
      schema: SubjectVisionSchema,
      node: 'visionSubject',
      messages,
      // NO reasoningEffort — vision uses the functionCalling / Chat Completions path
    });
  } catch (err) {
    logger.warn({ err: String(err) }, 'visionAnalyseSubject: LLM call failed — skipping vision');
  }

  // Always write photos back to state, regardless of vision success.
  return {
    subject: {
      ...state.subject,
      photos,
      visionAnalysis,
    },
  };
}
