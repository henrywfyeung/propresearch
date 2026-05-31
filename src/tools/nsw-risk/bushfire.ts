// src/tools/nsw-risk/bushfire.ts
// Bushfire risk adapter — queries the NSW Bush Fire Prone Lands (BFPL) layer
// on the DCCEEW/SEED ArcGIS host via arcgisPointQuery.
//
// Returns a RiskFlag when the point intersects a BFPL polygon, null when not
// on bush-fire-prone land (caller wraps null → 'None identified' informational
// flag at the node level per spec §4 / CLAUDE.md §7.17).
//
// Severity mapping (spec §1 / CLAUDE.md §7.11):
//   Category 1  → 'high'    (Vegetation Category 1 — highest fire danger)
//   Category 3  → 'medium'  (Vegetation Category 3)
//   Category 2  → 'low'     (Vegetation Category 2 — e.g. rainforest)
//   Category 0  → 'low'     (buffer / adjacency zone)
// When multiple features intersect, the MOST severe (lowest non-null category
// number) is used; Category 0 is treated as lower priority than 1, 2, 3.

import type { RiskFlag } from '@/schemas/state';
import { z } from 'zod';
import { arcgisPointQuery } from './arcgis';

// ---------------------------------------------------------------------------
// Layer config — verified 2026-06-01 via MapServer?f=json introspection
// ---------------------------------------------------------------------------

const BFPL_SERVICE = 'Fire/BFPL';
const BFPL_LAYER_NAME = 'NSW Bush Fire Prone Lands'; // layer 0, unique name

// ---------------------------------------------------------------------------
// ArcGIS attribute schema (strict-but-partial — only fields we parse)
// ---------------------------------------------------------------------------

const BfplAttributesSchema = z.object({
  Category: z.number(),
  d_Category: z.string(),
  // Guideline is an integer code, d_Guidelin is the human-readable string
  Guideline: z.number(),
  d_Guidelin: z.string(),
});

type BfplAttributes = z.infer<typeof BfplAttributesSchema>;

// ---------------------------------------------------------------------------
// Severity ordering — lower = more severe (1 is worst)
// ---------------------------------------------------------------------------

type BfplSeverity = 'high' | 'medium' | 'low';

function categoryToSeverity(category: number): BfplSeverity {
  switch (category) {
    case 1:
      return 'high';
    case 3:
      return 'medium';
    default:
      // Category 2 (rainforest), Category 0 (buffer/adjacency), and any
      // unknown value all map to 'low'.
      return 'low';
  }
}

/** Severity rank: lower = more severe. Used to find the worst feature. */
const SEVERITY_RANK: Record<BfplSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function mostSevere(features: BfplAttributes[]): BfplAttributes | null {
  if (features.length === 0) return null;
  return features.reduce<BfplAttributes>((worst, f) => {
    const wSev = categoryToSeverity(worst.Category);
    const fSev = categoryToSeverity(f.Category);
    return SEVERITY_RANK[fSev] < SEVERITY_RANK[wSev] ? f : worst;
  }, features[0]!);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query the NSW Bush Fire Prone Lands layer for the given coordinates.
 *
 * @param lat WGS84 latitude
 * @param lng WGS84 longitude
 * @returns RiskFlag when the point intersects a BFPL polygon; null otherwise.
 */
export async function queryBushfire(lat: number, lng: number): Promise<RiskFlag | null> {
  const arcgisBase =
    process.env.NSW_ARCGIS_BASE ?? 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services';
  const layerUrl = `${arcgisBase}/${BFPL_SERVICE}/MapServer/0/query`;

  const features = await arcgisPointQuery(
    {
      service: BFPL_SERVICE,
      layerName: BFPL_LAYER_NAME,
      lat,
      lng,
      outFields: ['Category', 'd_Category', 'Guideline', 'd_Guidelin'],
    },
    BfplAttributesSchema,
  );

  if (features.length === 0) return null;

  const worst = mostSevere(features);
  if (!worst) return null;

  return {
    category: 'bushfire',
    severity: categoryToSeverity(worst.Category),
    description: worst.d_Category,
    dataAvailable: true,
    sourceRef: {
      provider: 'overlays',
      endpoint: layerUrl,
      fetchedAt: new Date().toISOString(),
      path: '/risks/bushfire',
    },
    evidence: JSON.stringify({
      category: worst.Category,
      guideline: worst.d_Guidelin,
    }),
  };
}
