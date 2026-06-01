// src/prompts/compose.ts — Node 10 section prompts (CLAUDE.md §7.12). Bump
// `version` on wording changes ([R30]). Output is text-only narrative blocks;
// the node stamps the structured valuation claim.

import type { RecentDA, RiskFlag } from '@/schemas/state';
import type { LlmMessage } from '@/tools/llm/types';
import type { SuburbStats } from '@/tools/market/suburbStats';

export const version = 'v1.4';

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
  }>;
  risks: RiskFlag[];
  recentDAs: RecentDA[];
  suburbStats: SuburbStats | null;
}

const VOICE =
  'Voice: direct, confident, specific. No marketing language. Plain Australian English. Prices in AUD. Output ONLY a JSON object of the form {"blocks": [{"type":"text","text":"..."}]} whose "blocks" array holds the narrative prose blocks in order.';

const SECTION_BRIEF: Record<ComposeSection, string> = {
  summary:
    'Write the executive summary: the headline verdict on the property and where its value sits.',
  subject: 'Describe the subject property from its attributes (beds, baths, parking, land, type).',
  valuation:
    'Explain how the comparable sales support the estimated value range, and what the confidence and any uncertainty mean for a buyer.',
  comparables: 'Walk through the selected comparable sales and why they were chosen.',
  market:
    "Summarise the suburb's recent sales market from the stats — the typical price level, the spread, the sample size and how recent the data is. Frame it as market context (what's been selling), not a guarantee about the subject. If no stats are available, say the sample was too small.",
  risks:
    "Summarise the risk register: which constraints apply (flood / bushfire / heritage), their severity, and what each means for a buyer. State plainly when a category found nothing ('None identified.') or when data was unavailable — do not imply a property is risk-free when data is missing.",
  planning:
    'Summarise recent development activity near the property from the DA list — the volume, any notable or large applications (by cost/scale), and what it signals for the area and a buyer. State plainly if no DAs were found nearby or data was unavailable; do not invent activity.',
};

export function buildMessages(section: ComposeSection, input: ComposeInput): LlmMessage[] {
  const system = `You are writing the "${section}" section of a residential property research dossier. ${SECTION_BRIEF[section]} ${VOICE}`;
  const user = `Suburb: ${input.suburb}\nSubject attributes: ${JSON.stringify(input.subjectAttrs)}\nValuation: ${JSON.stringify(input.triangulation)}\nSelected comparables: ${JSON.stringify(input.selectedComps)}\nRisk register: ${JSON.stringify(input.risks)}\nRecent DAs: ${JSON.stringify(input.recentDAs)}\nSuburb stats: ${JSON.stringify(input.suburbStats)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
