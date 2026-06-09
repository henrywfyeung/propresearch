// ReportState — single source of truth for everything that flows through the
// graph. CLAUDE.md §5. All external data is validated into these types before
// the graph touches it.

import { z } from 'zod';
import { ClaimBlockSchema, ReportProseSchema, SectionIdSchema } from './claims';
import { SourceRefSchema } from './sources';
import { CompVisionSchema, StreetViewSchema, SubjectVisionSchema } from './vision';

// --------------------------------------------------------------------------
// Address / subject
// --------------------------------------------------------------------------

export const AusStateSchema = z.enum(['NSW', 'VIC', 'WA']);

export const CanonicalPropertyTypeSchema = z.enum([
  'House',
  'ApartmentUnitFlat',
  'Townhouse',
  'Villa',
  'Land',
  'Other',
]);

export const ResolvedAddressSchema = z.object({
  gnafId: z.string().optional(),
  lat: z.number(),
  lng: z.number(),
  suburb: z.string(),
  postcode: z.string(),
  state: AusStateSchema,
  normalizedAddress: z.string(),
});
export type ResolvedAddress = z.infer<typeof ResolvedAddressSchema>;

export const PropertyAttrsSchema = z.object({
  beds: z.number().int().nonnegative(),
  baths: z.number().int().nonnegative(),
  parking: z.number().int().nonnegative(),
  landArea: z.number().nonnegative().nullable(),
  buildingArea: z.number().nonnegative().nullable(),
  propertyType: z.string(),
});

export const ListingSchema = z.object({
  listingId: z.string(),
  url: z.string().url(),
  priceGuide: z.string().nullable(),
  daysOnMarket: z.number().int().nonnegative().nullable(),
  agency: z.string().nullable(),
  photos: z.array(z.string().url()),
});

export const SubjectPropertySchema = z.object({
  attrs: PropertyAttrsSchema,
  photos: z.array(z.string().url()),
  floorplans: z.array(z.string().url()).default([]),
  listing: ListingSchema.nullable(),
  visionAnalysis: SubjectVisionSchema.nullable(),
  streetView: StreetViewSchema.nullable(),
});
export type SubjectProperty = z.infer<typeof SubjectPropertySchema>;

// --------------------------------------------------------------------------
// Comparables
// --------------------------------------------------------------------------

export const AdjustmentSchema = z.object({
  dimension: z.string(),
  deltaPct: z.number().min(-0.3).max(0.3), // positive = subject worth more
  rationale: z.string().min(20),
  sourceRef: z.array(SourceRefSchema),
});

// Overall standing of a comparable *relative to the subject* (adopted from a
// professional CMA's "Overall Comparison" verdict). 'superior' = the comp is a
// better property than the subject (so its price sets a ceiling); 'inferior' =
// worse (sets a floor); 'comparable' = alike (its price sits in the band).
export const CompVerdictSchema = z.enum(['superior', 'comparable', 'inferior']);
export type CompVerdict = z.infer<typeof CompVerdictSchema>;

// Structured, human-readable comparison across the four axes a valuer reasons
// over. Each axis is a short phrase (bounded to keep PDF prose tight, in the
// spirit of the [R42] vision-enum freeze). Kept as discrete fields so a future
// interactive web report can render/filter per axis.
export const CompComparisonSchema = z.object({
  size: z.string().min(3).max(160),
  layout: z.string().min(3).max(160),
  condition: z.string().min(3).max(160),
  location: z.string().min(3).max(160),
});
export type CompComparison = z.infer<typeof CompComparisonSchema>;

export const ComparableSchema = z.object({
  id: z.string(),
  address: z.string(),
  salePrice: z.number().positive(),
  contractDate: z.string(), // ISO date
  distanceM: z.number().nonnegative(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  beds: z.number().int().nonnegative(),
  baths: z.number().int().nonnegative(),
  landArea: z.number().nonnegative().nullable(),
  propertyType: z.string(),
  photos: z.array(z.string().url()),
  // Canonical listing page URL (REA), used to deep-link the comp's "Source" line
  // in the PDF. Nullish so non-REA / older fixtures need not set it.
  listingUrl: z.string().url().nullish(),
  visionAnalysis: CompVisionSchema.nullable(),
  similarityScore: z.number().min(0).max(100),
  selection: z.enum(['fair-value', 'negotiation-anchor', 'rejected', 'candidate']),
  // Overall verdict vs the subject + the per-axis qualitative comparison
  // (Node 06). Nullable so degraded / pre-verdict reports still validate.
  verdict: CompVerdictSchema.nullable().default(null),
  comparison: CompComparisonSchema.nullable().default(null),
  adjustments: z.array(AdjustmentSchema).max(8),
  adjustedValue: z.number().nullable(),
  adjustmentNarrative: z.string().nullable(),
  source: SourceRefSchema,
});
export type Comparable = z.infer<typeof ComparableSchema>;

// --------------------------------------------------------------------------
// ABS Census demographics (SA2-level) — spec §2
// --------------------------------------------------------------------------

export const SuburbDemographicsSchema = z.object({
  sa2Code: z.string(),
  sa2Name: z.string(),
  population: z.number().nullable(),
  medianAge: z.number().nullable(),
  medianHouseholdIncomeWeekly: z.number().nullable(),
  medianPersonalIncomeWeekly: z.number().nullable(),
  medianRentWeekly: z.number().nullable(),
  medianMortgageMonthly: z.number().nullable(),
  avgHouseholdSize: z.number().nullable(),
  ownerOccupiedPct: z.number().nullable(),
  rentedPct: z.number().nullable(),
  // % of occupied dwellings owned WITH a mortgage (mortgage indebtedness).
  ownedWithMortgagePct: z.number().nullable(),
  // % rented from a state/territory housing authority or community provider
  // (social / public / "commission" housing).
  socialHousingPct: z.number().nullable(),
  // ABS SEIFA IRSAD: socio-economic advantage/disadvantage. Decile 1 (most
  // disadvantaged) – 10 (most advantaged), Australia-wide; score (mean ~1000).
  seifaIrsadDecile: z.number().nullable(),
  seifaIrsadScore: z.number().nullable(),
  censusYear: z.number(),
});
export type SuburbDemographics = z.infer<typeof SuburbDemographicsSchema>;

// --------------------------------------------------------------------------
// Market context / planning
// --------------------------------------------------------------------------

export const RecentDASchema = z.object({
  description: z.string(),
  status: z.string().nullable(),
  category: z.string().nullable(),
  distanceM: z.number().nonnegative(),
  lodgedDate: z.string().nullable(),
  coverage: z.enum(['full', 'metadata-only']), // [R10]
  sourceRef: SourceRefSchema,
});

export type RecentDA = z.infer<typeof RecentDASchema>;

export const MarketContextSchema = z.object({
  suburbStats: z.record(z.string(), z.unknown()).nullable(),
  recentNews: z.array(z.object({ headline: z.string(), url: z.string().url() })),
  recentDAs: z.array(RecentDASchema),
});
export type MarketContext = z.infer<typeof MarketContextSchema>;

// --------------------------------------------------------------------------
// Risk register
// --------------------------------------------------------------------------

export const RiskCategorySchema = z.enum([
  'flood',
  'bushfire',
  'heritage',
  'contamination',
  'noise',
  'flightpath',
  'planning',
  'strata',
  'market',
]);

export const RiskFlagSchema = z.object({
  category: RiskCategorySchema,
  severity: z.enum(['critical', 'high', 'medium', 'low', 'informational']),
  description: z.string(),
  sourceRef: SourceRefSchema.nullable(),
  evidence: z.string().nullable(),
  // null when the source was unavailable — render "data unavailable" (§7.17).
  dataAvailable: z.boolean(),
});
export type RiskFlag = z.infer<typeof RiskFlagSchema>;

// --------------------------------------------------------------------------
// Triangulation — CLAUDE.md §7.9 with the divergence guardrail [R43][R44]
// --------------------------------------------------------------------------

// Verdict-banded price bounds, derived deterministically from the comps' raw
// sold prices grouped by `verdict` (adopted from a professional CMA's banded
// scatter). These corroborate the similarity-weighted estimate rather than
// replace it: inferior sales top out at `inferiorCap` (a floor under the
// subject), superior sales start at `superiorFloor` (a ceiling), and
// like-for-like sales span `comparableLow`–`comparableHigh`. Any bound is null
// when no comp carries that verdict.
export const ValuationBandsSchema = z.object({
  inferiorCap: z.number().nullable(),
  comparableLow: z.number().nullable(),
  comparableHigh: z.number().nullable(),
  superiorFloor: z.number().nullable(),
  counts: z.object({
    inferior: z.number().int().nonnegative(),
    comparable: z.number().int().nonnegative(),
    superior: z.number().int().nonnegative(),
  }),
});
export type ValuationBands = z.infer<typeof ValuationBandsSchema>;

export const TriangulatedValueSchema = z
  .object({
    compDerived: z.number(), // similarity-weighted mean of fair-value comps' adjustedValue
    low: z.number(),
    high: z.number(),
    reconciled: z.number(), // = compDerived in v2 (single signal)
    confidence: z.enum(['high', 'medium', 'low']),
    spread: z.number().min(0), // (high - low) / median
    compIds: z.array(z.string()),
    bands: ValuationBandsSchema.nullable().default(null),
    uncertaintyNote: z.string().nullable(), // required when spread > 0.25
    narrative: z.string().min(40),
  })
  .refine(
    (v) => v.spread <= 0.25 || (v.confidence === 'low' && v.uncertaintyNote !== null),
    'high spread (>0.25) requires confidence=low and an uncertaintyNote',
  );
export type TriangulatedValue = z.infer<typeof TriangulatedValueSchema>;

// --------------------------------------------------------------------------
// Rentals / negotiation
// --------------------------------------------------------------------------

export const RentalEvidenceSchema = z.object({
  domainRentalAvm: z.number().nullable(),
  activeRentals: z.array(
    z.object({ address: z.string(), weeklyRent: z.number(), beds: z.number().int() }),
  ),
  indicativeWeeklyRent: z.number().nullable(),
  grossYieldPct: z.number().nullable(),
});
export type RentalEvidence = z.infer<typeof RentalEvidenceSchema>;

export const NegotiationPackSchema = z.object({
  daysOnMarketSignal: z.string().nullable(),
  suggestedOpeningOffer: z.object({
    value: z.number(),
    anchorCompIds: z.array(z.string()),
  }),
  walkAwayPrice: z.number(),
  positioning: z.enum(['move-fast', 'negotiate-hard', 'wait', 'pass']),
  // NOTE: per-agency underquote signal removed from v1 [R13].
});
export type NegotiationPack = z.infer<typeof NegotiationPackSchema>;

// --------------------------------------------------------------------------
// Critic findings
// --------------------------------------------------------------------------

export const CriticFindingSchema = z.object({
  severity: z.enum(['blocker', 'major', 'minor']),
  section: SectionIdSchema,
  claim: z.string().nullable(),
  description: z.string(),
  tag: z.string().optional(), // e.g. 'unresolved-source' [R22]
});
export type CriticFinding = z.infer<typeof CriticFindingSchema>;

// --------------------------------------------------------------------------
// Umbrella ReportState
// --------------------------------------------------------------------------

export const ReportStateSchema = z.object({
  reportId: z.string().uuid(),
  resolvedAddress: ResolvedAddressSchema.nullable(),
  subject: SubjectPropertySchema.nullable(),
  comparables: z.array(ComparableSchema),
  market: MarketContextSchema.nullable(),
  demographics: SuburbDemographicsSchema.nullable(),
  risks: z.array(RiskFlagSchema),
  triangulation: TriangulatedValueSchema.nullable(),
  rentals: RentalEvidenceSchema.nullable(),
  negotiation: NegotiationPackSchema.nullable(),
  prose: ReportProseSchema,
  criticFindings: z.array(CriticFindingSchema),
  reviseIterations: z.number().int().nonnegative().default(0),
  errors: z.array(z.object({ code: z.string(), message: z.string() })),
});
export type ReportState = z.infer<typeof ReportStateSchema>;

export { ClaimBlockSchema, SectionIdSchema };
