// src/tools/nsw-risk/flood.ts
// Flood risk adapter — queries the NSW ePlanning "Flood Planning Map" layer
// via arcgisPointQuery.
//
// IMPORTANT: This function ALWAYS returns a RiskFlag (never null) because an
// empty flood result is AMBIGUOUS. The layer covers only ~11 LGAs; returning
// "no flood risk" for an uncovered LGA (e.g. Hawkesbury) would be dangerous.
//
// Logic:
//   hit (≥1 feature) → dataAvailable:true, severity from LAY_CLASS
//   empty + lga ∈ COVERED_FLOOD_LGAS → dataAvailable:true, severity:'informational'
//   empty + (lga ∉ COVERED or lga===null) → dataAvailable:false, severity:'informational'
//
// Layer probed 2026-06-01:
//   ePlanning/Planning_Portal_Hazard/MapServer/230 "Flood Planning Map"
//   Covered LGAs (from layer's published LGA_NAME field — may grow):
//     BATHURST REGIONAL, CLARENCE VALLEY, FORBES, HORNSBY, MID-WESTERN REGIONAL,
//     TAMWORTH REGIONAL, WENTWORTH, WINGECARRIBEE, WOLLONGONG, YASS VALLEY
//
// LAY_CLASS severity mapping (from live distinct values):
//   'Probable Maximum Flood Line' | 'Level of Probable Maximum Flood' → 'high'
//   '1 in 100 AEP Flood Extent' | 'Flood Planning Area' |
//   'Flood Prone and Major Creeks Land' → 'high'
//   'Transitional Land' → 'low'
//   anything else (Area 1, Cultural Heritage Landscape Area, etc.) → 'medium'

import type { RiskFlag } from '@/schemas/state';
import { z } from 'zod';
import { arcgisPointQuery } from './arcgis';

// ---------------------------------------------------------------------------
// Layer config — verified 2026-06-01 via MapServer?f=json introspection
// ---------------------------------------------------------------------------

const FLOOD_SERVICE = 'ePlanning/Planning_Portal_Hazard';
const FLOOD_LAYER_NAME = 'Flood Planning Map'; // id 230
const FLOOD_LAYER_ID = 230;

// ---------------------------------------------------------------------------
// LGA coverage set
// Derived from the layer's published LGA_NAME values (probed 2026-06-01).
// This set may grow as more councils publish their LEP flood maps.
// To update: run a distinct-LGA_NAME query against the layer and add new entries.
// ---------------------------------------------------------------------------

export const COVERED_FLOOD_LGAS = new Set([
  'BATHURST REGIONAL',
  'CLARENCE VALLEY',
  'FORBES',
  'HORNSBY',
  'MID-WESTERN REGIONAL',
  'TAMWORTH REGIONAL',
  'WENTWORTH',
  'WINGECARRIBEE',
  'WOLLONGONG',
  'YASS VALLEY',
]);

// ---------------------------------------------------------------------------
// ArcGIS attribute schema (strict-but-partial — only fields we parse)
// ---------------------------------------------------------------------------

const FloodAttributesSchema = z.object({
  EPI_NAME: z.string(),
  LGA_NAME: z.string(),
  LAY_CLASS: z.string(),
  EPI_TYPE: z.string(),
});

type FloodAttributes = z.infer<typeof FloodAttributesSchema>;

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

type FloodSeverity = 'high' | 'medium' | 'low';

function layClassToSeverity(layClass: string): FloodSeverity {
  const c = layClass.toLowerCase();
  if (c.includes('probable maximum flood')) return 'high';
  if (c.includes('1 in 100') || c.includes('aep') || c.includes('flood planning area')) {
    return 'high';
  }
  if (c.includes('flood prone') || c.includes('flood-prone')) return 'high';
  if (c.includes('transitional')) return 'low';
  return 'medium';
}

/** Severity rank: lower number = more severe. Used to pick the worst feature. */
const SEVERITY_RANK: Record<FloodSeverity, number> = { high: 0, medium: 1, low: 2 };

function mostSevereFeature(features: FloodAttributes[]): FloodAttributes {
  // Caller ensures features.length >= 1
  return features.reduce<FloodAttributes>((worst, f) => {
    const wRank = SEVERITY_RANK[layClassToSeverity(worst.LAY_CLASS)];
    const fRank = SEVERITY_RANK[layClassToSeverity(f.LAY_CLASS)];
    return fRank < wRank ? f : worst;
  }, features[0]!);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query the NSW ePlanning Flood Planning Map layer for the given coordinates.
 *
 * @param lat WGS84 latitude
 * @param lng WGS84 longitude
 * @param lga The LGA name (UPPERCASE) for the coordinate, or null when
 *            LGA resolution failed. Used to disambiguate an empty result.
 * @returns Always a RiskFlag — never null. See module-level JSDoc for the
 *          three return branches.
 */
export async function queryFlood(lat: number, lng: number, lga: string | null): Promise<RiskFlag> {
  const arcgisBase =
    process.env.NSW_ARCGIS_BASE ?? 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services';
  const layerUrl = `${arcgisBase}/${FLOOD_SERVICE}/MapServer/${FLOOD_LAYER_ID}/query`;

  const features = await arcgisPointQuery(
    {
      service: FLOOD_SERVICE,
      layerName: FLOOD_LAYER_NAME,
      layerId: FLOOD_LAYER_ID,
      lat,
      lng,
      outFields: ['EPI_NAME', 'LGA_NAME', 'LAY_CLASS', 'EPI_TYPE'],
    },
    FloodAttributesSchema,
  );

  // ---- Branch 1: hit -------------------------------------------------------
  if (features.length > 0) {
    const worst = mostSevereFeature(features);
    return {
      category: 'flood',
      severity: layClassToSeverity(worst.LAY_CLASS),
      description: worst.LAY_CLASS,
      dataAvailable: true,
      sourceRef: {
        provider: 'overlays',
        endpoint: layerUrl,
        fetchedAt: new Date().toISOString(),
        path: '/risks/flood',
      },
      evidence: JSON.stringify({
        layClass: worst.LAY_CLASS,
        epi: worst.EPI_NAME,
      }),
    };
  }

  // ---- Branch 2: empty + covered LGA --------------------------------------
  if (lga !== null && COVERED_FLOOD_LGAS.has(lga)) {
    return {
      category: 'flood',
      severity: 'informational',
      description: 'No flood-planning constraint mapped at this address.',
      dataAvailable: true,
      sourceRef: {
        provider: 'overlays',
        endpoint: layerUrl,
        fetchedAt: new Date().toISOString(),
        path: '/risks/flood',
      },
      evidence: null,
    };
  }

  // ---- Branch 3: empty + uncovered or null LGA ----------------------------
  // NEVER return a false "no flood risk" for an uncovered LGA.
  return {
    category: 'flood',
    severity: 'informational',
    description:
      'NSW has not published LEP flood-planning mapping for this LGA — assess flood risk separately.',
    dataAvailable: false,
    sourceRef: null,
    evidence: null,
  };
}
