// src/prompts/compose.ts — Node 10 section prompts (CLAUDE.md §7.12). Bump
// `version` on wording changes ([R30]). Output is text-only narrative blocks;
// the node stamps the structured valuation claim.

import type { RecentDA, RiskFlag, SuburbDemographics } from '@/schemas/state';
import type { LlmMessage } from '@/tools/llm/types';
import type { SuburbStats } from '@/tools/market/suburbStats';

export const version = 'v1.7';

export type ComposeSection =
  | 'summary'
  | 'subject'
  | 'valuation'
  | 'comparables'
  | 'market'
  | 'risks'
  | 'planning';

export interface ComposeInput {
  suburb: string;
  subjectAttrs: {
    beds: number;
    baths: number;
    parking: number;
    landArea: number | null;
    buildingArea: number | null;
    propertyType: string;
  };
  triangulation: {
    compDerived: number;
    low: number;
    high: number;
    reconciled: number;
    confidence: 'high' | 'medium' | 'low';
    spread: number;
    bands?: {
      inferiorCap: number | null;
      comparableLow: number | null;
      comparableHigh: number | null;
      superiorFloor: number | null;
    } | null;
  } | null;
  selectedComps: Array<{
    id: string;
    address: string;
    salePrice: number;
    adjustedValue: number | null;
    contractDate: string;
    beds: number;
    baths: number;
    propertyType: string;
    selection: string;
    verdict: 'superior' | 'comparable' | 'inferior' | null;
    comparison: { size: string; layout: string; condition: string; location: string } | null;
  }>;
  risks: RiskFlag[];
  recentDAs: RecentDA[];
  suburbStats: SuburbStats | null;
  demographics: SuburbDemographics | null;
}

const VOICE =
  'Voice: direct, confident, specific. No marketing language. Plain Australian English. Prices in AUD. Output ONLY a JSON object of the form {"blocks": [{"type":"text","text":"..."}]} whose "blocks" array holds the narrative prose blocks in order.';

const SECTION_BRIEF: Record<ComposeSection, string> = {
  summary:
    'Write the executive summary: the headline verdict on the property and where its value sits.',
  subject: 'Describe the subject property from its attributes (beds, baths, parking, land, type).',
  valuation:
    'Explain how the comparable sales support the estimated value range, and what the confidence and any uncertainty mean for a buyer. If quality "bands" are provided, mention them only as light market context (the rough span comparable sales fell in) — do NOT raise an alarm about where the estimate sits relative to the bands, and do not claim the estimate is "outside" any bracket. Keep it to one or two sentences grounded in the range + confidence.',
  comparables:
    'Walk through the selected comparable sales. For each, state its overall verdict versus the subject (superior / comparable / inferior), the key size/layout/condition/location differences, its adjusted value, and why it was chosen. CONSISTENCY RULES: (1) anchor framing must follow the ADJUSTED VALUE, not the verdict — call an anchor "upper-end" only if its adjusted value is ABOVE the estimate and "lower-end" only if BELOW; never call a higher-adjusted comp a lower-end anchor. (2) Keep the verdict, adjusted value and anchor wording mutually consistent (e.g. do not describe an inferior-graded comp that adjusted to a HIGH value as the "cheaper/lower" reference). Be specific and balanced.',
  market:
    "Summarise the suburb's recent sales market from the stats — the typical price level, the spread, the sample size and how recent the data is. Frame it as market context (what's been selling), not a guarantee about the subject. If no stats are available, say the sample was too small. Additionally, if demographic data is available, note the suburb's profile — population, median age, household income, owner-occupier vs renter mix — as buyer context. Rent figures are weekly, mortgage monthly.",
  risks:
    "Summarise the risk register: which constraints apply (flood / bushfire / heritage), their severity, and what each means for a buyer. State plainly when a category found nothing ('None identified.') or when data was unavailable — do not imply a property is risk-free when data is missing.",
  planning:
    'Summarise recent development activity near the property from the DA list — the volume, any notable or large applications (by cost/scale), and what it signals for the area and a buyer. State plainly if no DAs were found nearby or data was unavailable; do not invent activity.',
};

export function buildMessages(section: ComposeSection, input: ComposeInput): LlmMessage[] {
  const system = `You are writing the "${section}" section of a residential property research dossier. ${SECTION_BRIEF[section]} ${VOICE}`;
  const user = `Suburb: ${input.suburb}\nSubject attributes: ${JSON.stringify(input.subjectAttrs)}\nValuation: ${JSON.stringify(input.triangulation)}\nSelected comparables: ${JSON.stringify(input.selectedComps)}\nRisk register: ${JSON.stringify(input.risks)}\nRecent DAs: ${JSON.stringify(input.recentDAs)}\nSuburb stats: ${JSON.stringify(input.suburbStats)}\nDemographics: ${JSON.stringify(input.demographics)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
