// src/agents/nodes/04c_streetView.ts — Node 04c (CLAUDE.md §7.6 / §8.5).
// Google Static Street View at four headings (N/E/S/W) → GPT-5 vision →
// structured StreetView read (streetCharacter / busyRoad / treeCover /
// neighbouringConcerns). This is the street-LEVEL counterpart to Node 04a's
// listing-photo read: it grounds the "Location" axis of the comp comparison and
// adds a Street-level assessment block to the dossier.
//
// Chained AFTER visionSubject (NOT a parallel branch) because both nodes write
// `state.subject` and the subject reducer is last-write-wins — running them in
// parallel would clobber whichever finished first. Reading the post-visionSubject
// subject and spreading it forward keeps photos/floorplans/visionAnalysis intact.
//
// Graceful at every step (§7.17): no GOOGLE_MAPS_KEY, no coordinates, no imagery
// for any heading, or a vision failure all leave subject.streetView = null and
// the node continues. The street-level section simply won't render.

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import { StreetViewSchema } from '@/schemas/vision';
import { callWithFallback } from '@/tools/llm/structuredCall';
import type { ContentPart, LlmMessage } from '@/tools/llm/types';
import { fetchStreetViewImages } from '@/tools/streetview/fetch';

const SYSTEM_TEXT =
  'You are a property analyst assessing a residential street from Google Street View images ' +
  'taken at four compass headings (north, east, south, west) from the kerb outside the subject ' +
  'property. Judge the STREET, not the house. Return a structured read: ' +
  'streetCharacter (leafy-residential = quiet tree-lined residential; arterial = a busy through-road; ' +
  'commercial-frontage = shops/offices facing the street; industrial-adjacent = warehouses/industry nearby; ' +
  'mixed = a blend; unclassified = genuinely unclear from these images); ' +
  'busyRoad (true if it looks like a main/arterial road carrying through-traffic, false for a quiet local street); ' +
  'treeCover (high / medium / low canopy and greenery); ' +
  'and up to 4 short neighbouringConcerns — specific visible negatives a buyer would want flagged ' +
  '(e.g. "powerlines overhead", "bus stop directly outside", "commercial building adjoining", ' +
  '"on-street parking congestion"). Be conservative and factual; do not use marketing language; ' +
  'omit a concern rather than guess.';

const USER_TEXT =
  'These are Street View images of the street outside the subject property, at four headings. ' +
  'Return a structured street-level assessment.';

function buildMessages(dataUrls: string[]): LlmMessage[] {
  const imageParts: ContentPart[] = dataUrls.map((url) => ({
    type: 'image_url',
    image_url: { url },
  }));
  return [
    { role: 'system', content: SYSTEM_TEXT },
    { role: 'user', content: [{ type: 'text', text: USER_TEXT }, ...imageParts] },
  ];
}

export async function streetView(state: GraphState): Promise<Partial<GraphState>> {
  const { subject, resolvedAddress } = state;
  if (!subject) {
    return { errors: [{ code: 'PARTIAL_DATA', message: 'streetView: no subject in state' }] };
  }

  // No coordinates or no API key → skip silently (street view simply absent).
  if (!resolvedAddress || !process.env.GOOGLE_MAPS_KEY) {
    return { subject: { ...subject, streetView: null } };
  }

  // Fetch all four headings; any per-heading failure yields a null slot.
  const images = await fetchStreetViewImages(resolvedAddress.lat, resolvedAddress.lng).catch(
    () => [],
  );
  const dataUrls = images.flatMap((i) =>
    i.bytes ? [`data:image/jpeg;base64,${i.bytes.toString('base64')}`] : [],
  );

  // No imagery at this location (rural / new estate / GSV gap) → no assessment.
  if (dataUrls.length === 0) {
    logger.info({ reportId: state.reportId }, 'streetView: no imagery available for any heading');
    return { subject: { ...subject, streetView: null } };
  }

  const model = process.env.OPENAI_MODEL_VISION || process.env.OPENAI_MODEL_REASONING || '';

  let assessment = null;
  try {
    assessment = await callWithFallback({
      model,
      schema: StreetViewSchema,
      node: 'streetView',
      messages: buildMessages(dataUrls),
      // NO reasoningEffort — vision uses the Chat Completions / function path.
    });
  } catch (err) {
    logger.warn({ err: String(err) }, 'streetView: vision call failed — skipping assessment');
  }

  return { subject: { ...subject, streetView: assessment } };
}
