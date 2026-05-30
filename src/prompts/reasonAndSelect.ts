// src/prompts/reasonAndSelect.ts — Node 06 prompt (CLAUDE.md §7.8). Bump `version`
// when the wording changes ([R30]).

import type { LlmMessage } from '@/tools/llm/types';

export const version = 'v1.0';

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
}

export interface ReasonSelectPromptInput {
  subject: {
    suburb: string;
    attrs: {
      beds: number;
      baths: number;
      parking: number;
      landArea: number | null;
      buildingArea: number | null;
      propertyType: string;
    };
  };
  comps: ReasonSelectComp[];
}

const SYSTEM = `You are a property valuation analyst selecting and adjusting comparable sales for a subject property in Australia.

Rules:
- Never invent attributes not given.
- Express each adjustment as a percentage delta in [-0.30, 0.30]; positive means the SUBJECT is worth MORE than the comp on that dimension.
- Total adjustments per comp should rarely exceed ±15%. If a comp needs more, mark it "rejected" with a rejectionReason.
- Select 4-5 comps as "fair-value" and 2-3 as "negotiation-anchor". Mark all others "rejected".
- Return exactly one decision for every comp id provided. Each decision: compId, selection, rejectionReason (null unless rejected), adjustments[] (dimension, delta, rationale >=20 chars), adjustmentNarrative (>=60 chars), adjustedValue (the comp's sale price adjusted toward the subject, in AUD), selectionRationale (>=40 chars).`;

export function buildMessages(input: ReasonSelectPromptInput): LlmMessage[] {
  const user = `Subject (suburb ${input.subject.suburb}):\n${JSON.stringify(input.subject.attrs)}\n\nCandidate comparables (${input.comps.length}):\n${JSON.stringify(input.comps)}`;
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];
}
