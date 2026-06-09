// src/tools/vic-risk/flood.ts
// VIC flood risk adapter — queries the Vicmap plan_overlay layer for flood
// planning scheme overlays: LSIO (Land Subject to Inundation Overlay),
// FO (Floodway Overlay), SBO (Special Building Overlay — drainage/flood).
//
// Unlike the NSW flood adapter, the VIC WFS is statewide — an empty result
// genuinely means no flood overlay at this point. Returns null when empty.
//
// Severity mapping (spec §1 design doc):
//   FO  → 'high'   (Floodway — most restrictive, prohibits most development)
//   LSIO → 'medium' (Land Subject to Inundation — moderate constraint)
//   SBO → 'medium' (Special Building Overlay — drainage / flooding context)
// When multiple overlays intersect, the most severe (FO > LSIO/SBO) wins.

import type { RiskFlag } from '@/schemas/state';
import { z } from 'zod';
import { vicWfsPointQuery } from './wfs';

// ---------------------------------------------------------------------------
// Layer config
// ---------------------------------------------------------------------------

const PLAN_OVERLAY_TYPE = 'open-data-platform:plan_overlay';
const FLOOD_CQL_EXTRA = "scheme_code IN ('LSIO','FO','SBO')";
const FLOOD_PROPERTY_NAMES = 'scheme_code,zone_code,zone_description,lga,gaz_begin_date';

// WFS endpoint for sourceRef (base URL without params)
const VIC_WFS_BASE = process.env.VIC_VICMAP_WFS ?? 'https://opendata.maps.vic.gov.au/geoserver/wfs';
const FLOOD_ENDPOINT = `${VIC_WFS_BASE}?typeNames=${PLAN_OVERLAY_TYPE}`;

// ---------------------------------------------------------------------------
// Attribute schema
// ---------------------------------------------------------------------------

const FloodOverlaySchema = z.object({
  scheme_code: z.string(),
  zone_code: z.string().nullable().optional(),
  zone_description: z.string().nullable().optional(),
  lga: z.string().nullable().optional(),
  gaz_begin_date: z.string().nullable().optional(),
});

type FloodOverlay = z.infer<typeof FloodOverlaySchema>;

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

type FloodSeverity = 'high' | 'medium';

function schemeToSeverity(schemeCode: string): FloodSeverity {
  return schemeCode === 'FO' ? 'high' : 'medium';
}

const SEVERITY_RANK: Record<FloodSeverity, number> = { high: 0, medium: 1 };

function mostSevere(features: FloodOverlay[]): FloodOverlay | null {
  if (features.length === 0) return null;
  return features.reduce<FloodOverlay>((worst, f) => {
    const wRank = SEVERITY_RANK[schemeToSeverity(worst.scheme_code)];
    const fRank = SEVERITY_RANK[schemeToSeverity(f.scheme_code)];
    return fRank < wRank ? f : worst;
  }, features[0]!);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query the Vicmap plan_overlay layer for VIC flood planning overlays
 * (LSIO / FO / SBO) at the given coordinates.
 *
 * @param lat WGS84 latitude
 * @param lng WGS84 longitude
 * @returns RiskFlag when one or more flood overlays intersect; null otherwise.
 */
export async function queryVicFlood(lat: number, lng: number): Promise<RiskFlag | null> {
  const features = await vicWfsPointQuery(
    {
      typeName: PLAN_OVERLAY_TYPE,
      lat,
      lng,
      propertyName: FLOOD_PROPERTY_NAMES,
      cqlExtra: FLOOD_CQL_EXTRA,
    },
    FloodOverlaySchema,
  );

  if (features.length === 0) return null;

  const worst = mostSevere(features);
  if (!worst) return null;

  return {
    category: 'flood',
    severity: schemeToSeverity(worst.scheme_code),
    description: worst.zone_description ?? worst.scheme_code,
    dataAvailable: true,
    sourceRef: {
      provider: 'overlays',
      endpoint: FLOOD_ENDPOINT,
      fetchedAt: new Date().toISOString(),
      path: '/risks/flood',
    },
    evidence: JSON.stringify({
      scheme_code: worst.scheme_code,
      zone_code: worst.zone_code ?? null,
      lga: worst.lga ?? null,
      gaz_begin_date: worst.gaz_begin_date ?? null,
    }),
  };
}
