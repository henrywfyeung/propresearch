// src/prompts/reasonAndSelect.ts — Node 06 prompts (CLAUDE.md §7.8), 3-phase
// map-reduce: PLAN (triage all comps) → ANALYSE (deep, batched, the map) →
// SELECT (pick the value set, the reduce). Bump the relevant version on wording
// changes ([R30]); each phase versions independently.

import type { CompLayout, Condition, SubjectLayout } from '@/schemas/vision';
import type { LlmMessage } from '@/tools/llm/types';

export const planVersion = 'v1.0';
export const analyseVersion = 'v1.2';
export const selectVersion = 'v1.1';

export interface ReasonSubject {
  suburb: string;
  attrs: {
    beds: number;
    baths: number;
    parking: number;
    landArea: number | null;
    buildingArea: number | null;
    propertyType: string;
  };
  layout: SubjectLayout | null;
  condition: Condition | null;
}

export interface ReasonSelectComp {
  id: string;
  address: string;
  salePrice: number;
  contractDate: string;
  distanceM: number;
  beds: number;
  baths: number;
  landArea: number | null;
  propertyType: string;
  similarityScore: number;
  layout: CompLayout | null;
  condition: Condition | null;
}

/** Compact analysed-comp summary the SELECT (reduce) phase chooses from. */
export interface AnalysedComp {
  id: string;
  address: string;
  adjustedValue: number;
  verdict: string;
  beds: number;
  baths: number;
  distanceM: number;
  similarityScore: number;
  recommendExclude: boolean;
}

function subjectBlock(s: ReasonSubject): string {
  return (
    `Subject (suburb ${s.suburb}):\n${JSON.stringify(s.attrs)}\n` +
    `Subject layout: ${JSON.stringify(s.layout)}\nSubject condition: ${JSON.stringify(s.condition)}`
  );
}

// --- Phase 1: PLAN ---------------------------------------------------------

const PLAN_SYSTEM = `You are triaging comparable sales for a subject residential property in Australia.
For EVERY comp id provided, return a plan entry with:
- verdict: how the comp compares to the SUBJECT as a property (not its sale price): "superior" (a better property, typically sells higher), "inferior" (a worse property), or "comparable" (genuinely like-for-like). Use the structured attributes/layout/condition.
- shortlist: true for the ~10-12 comps most worth DEEP analysis — the closest like-for-like sales, plus a few that bracket the subject just above and just below in quality. Mark clearly unsuitable comps shortlist:false.
Return exactly one plan per comp id. Keep it fast: no prose, just the verdict + shortlist flag.`;

export function buildPlanMessages(subject: ReasonSubject, comps: ReasonSelectComp[]): LlmMessage[] {
  const user = `${subjectBlock(subject)}\n\nComparables to triage (${comps.length}):\n${JSON.stringify(comps)}`;
  return [
    { role: 'system', content: PLAN_SYSTEM },
    { role: 'user', content: user },
  ];
}

// --- Phase 2: ANALYSE (the map) --------------------------------------------

const ANALYSE_SYSTEM = `You are a property valuation analyst deeply analysing a batch of comparable sales against a subject property in Australia.
Rules:
- Never invent attributes not given.
- Express each adjustment as a percentage delta in [-0.30, 0.30]; positive means the SUBJECT is worth MORE than the comp on that dimension (so a clearly SUPERIOR comp gets NEGATIVE deltas and its adjustedValue must come DOWN well below its sale price; an inferior comp gets positive deltas and adjusts UP).
- adjustedValue = the comp's sale price moved toward what the SUBJECT would fetch. CRITICAL: never leave a superior, much-higher-priced comp's adjustedValue near its own sale price — that inflates the valuation. If a comp is so different that bringing its adjustedValue near the subject's level would need more than about ±15% total adjustment, set recommendExclude:true with a recommendExcludeReason (it is too different to rely on); otherwise recommendExclude:false, reason null.
- A difference in BEDROOM COUNT (or property type) is a MAJOR mismatch — such a comp almost always needs more than ±15% to align, so set recommendExclude:true rather than applying a large bedroom "premium". Keep adjustments sane: never adjust an inferior/smaller comp UP to an adjustedValue ABOVE the genuine like-for-like (same beds/baths) comparables, and never adjust a superior comp DOWN below them — that ordering is nonsensical. Inferior comps should land at the LOWER end of the adjusted range, superior at the UPPER end.
- For each comp give an overall "verdict" vs the SUBJECT ("superior" / "inferior" / "comparable" — judge the property, not its price) and a "comparison" object with one concise phrase (3-160 chars) per axis stating how the comp differs from the SUBJECT:
  - size: land/internal area and overall scale.
  - layout: bed/bath/living configuration, single vs multi storey, position in any block/complex, shared walls.
  - condition: presentation, age, renovation, build quality.
  - location: street quality, position, aspect, proximity to amenity or nuisance.
- Ground the Size/Layout/Condition axes in the structured "layout" + "condition" facts provided for the subject and each comp; say what is unknown rather than inventing detail.
- Return exactly one analysis per comp id in the batch. Each: compId, verdict, comparison {size, layout, condition, location}, adjustments[] (dimension, delta, rationale >=20 chars), adjustmentNarrative (>=60 chars), adjustedValue (the comp's sale price adjusted toward the subject, in AUD), recommendExclude, recommendExcludeReason.`;

export function buildAnalyseMessages(
  subject: ReasonSubject,
  batch: ReasonSelectComp[],
): LlmMessage[] {
  const user = `${subjectBlock(subject)}\n\nComparables to analyse in this batch (${batch.length}):\n${JSON.stringify(batch)}`;
  return [
    { role: 'system', content: ANALYSE_SYSTEM },
    { role: 'user', content: user },
  ];
}

// --- Phase 3: SELECT (the reduce) ------------------------------------------

const SELECT_SYSTEM = `You are selecting the working comparable set for a subject property valuation in Australia, from a pool of ALREADY-ANALYSED comps.
Rules:
- Select 4-5 comps as "fair-value" and 2-3 as "negotiation-anchor" (useful as aggressive/low reference points). Mark all others "rejected".
- fair-value comps MUST be the closest like-for-like sales: prefer a "comparable" verdict and the smallest adjustments, and their adjustedValues should cluster tightly. Do NOT put a clearly "superior", much-higher-priced comp in fair-value — it inflates the estimate; superior comps belong in anchors or rejected.
- Any comp with recommendExclude:true MUST be "rejected".
- If few "comparable"-verdict comps exist, choose for fair-value the comps whose adjustedValue sits in the tight central cluster (closest to each other / the median), NOT the highest-priced outliers.
- Return exactly one selection per comp id provided. Each: compId, selection, rejectionReason (null unless rejected), selectionRationale (>=40 chars).`;

export function buildSelectMessages(
  subject: ReasonSubject,
  analysed: AnalysedComp[],
): LlmMessage[] {
  const user = `${subjectBlock(subject)}\n\nAnalysed comparables to select from (${analysed.length}):\n${JSON.stringify(analysed)}`;
  return [
    { role: 'system', content: SELECT_SYSTEM },
    { role: 'user', content: user },
  ];
}
