// src/agents/nodes/04a_visionAnalyseSubject.ts — Node 04a (CLAUDE.md §7.4).
// GPT-5.4 vision over listing photos → structured SubjectVision.
//
// Photo sources (separate, de-duplicated within each list):
//   1. subject.photos  — REA CDN listing photos + user-supplied extras.
//   2. subject.floorplans — REA CDN floor-plan images (kept distinct so the
//      render node can show them in a separate "Floor plan" block).
//
// Vision sees: photos.slice(0,7) + floorplans.slice(0,1) (cap 8 total).
//
// - No subject → in-band PARTIAL_DATA error (mirrors node 09/12 style).
// - photos + floorplans written to state regardless of whether vision succeeds
//   (so the render's photo grid + floor-plan block shows even if the LLM fails).
// - No photos AND no floorplans → return early with empty arrays + null visionAnalysis.
// - Up to 8 images sent as image_url parts in a multimodal HumanMessage.
// - Calls callWithFallback on the NON-reasoning path (no reasoningEffort).
// - Any LLM failure is caught → photos/floorplans still written, visionAnalysis null (graceful).

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import { SubjectVisionSchema } from '@/schemas/vision';
import { callWithFallback } from '@/tools/llm/structuredCall';
import type { ContentPart, LlmMessage } from '@/tools/llm/types';
import { fetchListingMedia } from '@/tools/rapidapi/listingMedia';

const MAX_VISION_PHOTOS = 7; // photos sent to vision (leaves 1 slot for a floorplan)
const MAX_VISION_FLOORPLANS = 1; // at most 1 floorplan sent to vision

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

  // Listing photos: REA CDN photos first, then user-supplied extras. Dedup by URL.
  const photos = [...new Set([...(media?.photos ?? []), ...(state.subject.photos ?? [])])];

  // Floor plans: kept separate so the PDF can render a distinct "Floor plan" block.
  const floorplans = [...new Set([...(media?.floorplans ?? [])])];

  // Nothing to show or analyse — return early with both arrays written (empty).
  if (photos.length === 0 && floorplans.length === 0) {
    return {
      subject: {
        ...state.subject,
        photos: [],
        floorplans: [],
        visionAnalysis: null,
      },
    };
  }

  // Vision sees: up to 7 listing photos + up to 1 floor plan (cap 8 total).
  const visionUrls = [
    ...photos.slice(0, MAX_VISION_PHOTOS),
    ...floorplans.slice(0, MAX_VISION_FLOORPLANS),
  ];

  // Build multimodal message: text instruction + one image_url per photo
  const imageParts: ContentPart[] = visionUrls.map((url) => ({
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

  // Always write photos + floorplans back to state, regardless of vision success.
  return {
    subject: {
      ...state.subject,
      photos,
      floorplans,
      visionAnalysis,
    },
  };
}
