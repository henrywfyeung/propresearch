// Provenance schemas — CLAUDE.md §5.1. Every numeric/factual claim carries a
// SourceRef. The `path` (RFC 6901 JSON Pointer) is REQUIRED: it locates the
// canonical value in ReportState so the deterministic critic (§7.13 Pass 1)
// can verify the rendered claim against the source value. [R22]

import { z } from 'zod';

export const ProviderSchema = z.enum([
  'rea', // realestate.com.au via the realty-base-au RapidAPI proxy (comp source)
  'nsw-vg',
  'rea+nsw-vg', // merged comp: REA attrs/photos + NSW VG authoritative price (spec §5.4)
  'mapbox',
  'street-view',
  'nsw-planning',
  'council-da',
  'overlays',
  'derived',
  'llm',
]);
export type Provider = z.infer<typeof ProviderSchema>;

export const SourceRefSchema = z.object({
  provider: ProviderSchema,
  endpoint: z.string(),
  fetchedAt: z.string().datetime(),
  // JSON Pointer into ReportState, e.g. "/comparables/0/salePrice".
  // Required — `raw` is stripped before persistence, so this is the only way
  // the critic can resolve a claim back to its source value. [R22]
  path: z.string().regex(/^(\/[^/]+)+$/, 'must be a JSON Pointer like /comparables/0/salePrice'),
  // dev-mode only; stripped before persistence (§4.3).
  raw: z.unknown().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

/** Wrapper attaching provenance to any value. */
export function sourced<T extends z.ZodTypeAny>(value: T) {
  return z.object({ value, source: SourceRefSchema });
}
export type Sourced<T> = { value: T; source: SourceRef };
