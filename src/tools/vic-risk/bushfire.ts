// src/tools/vic-risk/bushfire.ts
// VIC bushfire risk adapter — queries TWO layers in parallel:
//
//   (a) plan_overlay with scheme_code='BMO' (Bushfire Management Overlay)
//       → severity 'high' (most restrictive; development controls apply)
//   (b) open-data-platform:bushfire_prone_area (statutory BPA designation)
//       → severity 'medium' (baseline risk; less restrictive than BMO)
//
// Merge logic: BMO present → 'high'; BPA present (BMO absent) → 'medium'; neither → null.
// Evidence is merged from whichever sources hit.

import type { RiskFlag } from '@/schemas/state';
import { z } from 'zod';
import { vicWfsPointQuery } from './wfs';

// ---------------------------------------------------------------------------
// Layer config
// ---------------------------------------------------------------------------

const PLAN_OVERLAY_TYPE = 'open-data-platform:plan_overlay';
const BPA_TYPE = 'open-data-platform:bushfire_prone_area';

const BMO_CQL_EXTRA = "scheme_code='BMO'";
const PLAN_OVERLAY_PROPERTIES = 'scheme_code,zone_code,zone_description,lga,gaz_begin_date';
const BPA_PROPERTIES = 'lga_name,plan_number,gazettal_date';

const VIC_WFS_BASE = process.env.VIC_VICMAP_WFS ?? 'https://opendata.maps.vic.gov.au/geoserver/wfs';
const BUSHFIRE_ENDPOINT = `${VIC_WFS_BASE}?typeNames=${PLAN_OVERLAY_TYPE},${BPA_TYPE}`;

// ---------------------------------------------------------------------------
// Attribute schemas
// ---------------------------------------------------------------------------

const BmoOverlaySchema = z.object({
  scheme_code: z.string(),
  zone_code: z.string().nullable().optional(),
  zone_description: z.string().nullable().optional(),
  lga: z.string().nullable().optional(),
  gaz_begin_date: z.string().nullable().optional(),
});

type BmoOverlay = z.infer<typeof BmoOverlaySchema>;

const BpaSchema = z.object({
  lga_name: z.string().nullable().optional(),
  plan_number: z.string().nullable().optional(),
  gazettal_date: z.string().nullable().optional(),
});

type BpaFeature = z.infer<typeof BpaSchema>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query both VIC bushfire layers in parallel.
 *
 * BMO (plan_overlay scheme_code='BMO') → severity 'high'
 * BPA (bushfire_prone_area) → severity 'medium'
 * Neither → null
 *
 * @param lat WGS84 latitude
 * @param lng WGS84 longitude
 * @returns Merged RiskFlag, or null when neither layer intersects.
 */
export async function queryVicBushfire(lat: number, lng: number): Promise<RiskFlag | null> {
  const [bmoFeatures, bpaFeatures] = await Promise.all([
    vicWfsPointQuery(
      {
        typeName: PLAN_OVERLAY_TYPE,
        lat,
        lng,
        propertyName: PLAN_OVERLAY_PROPERTIES,
        cqlExtra: BMO_CQL_EXTRA,
      },
      BmoOverlaySchema,
    ),
    vicWfsPointQuery(
      {
        typeName: BPA_TYPE,
        lat,
        lng,
        propertyName: BPA_PROPERTIES,
      },
      BpaSchema,
    ),
  ]);

  const bmoHit: BmoOverlay | null = bmoFeatures[0] ?? null;
  const bpaHit: BpaFeature | null = bpaFeatures[0] ?? null;

  // Neither layer hit
  if (bmoHit === null && bpaHit === null) return null;

  // Determine severity
  const severity = bmoHit !== null ? 'high' : 'medium';

  // Build description
  const description =
    bmoHit !== null
      ? (bmoHit.zone_description ?? 'Bushfire Management Overlay (BMO)')
      : 'Bushfire Prone Area (BPA)';

  // Merge evidence from whichever sources hit
  const evidence: Record<string, unknown> = {};
  if (bmoHit !== null) {
    evidence.bmo = {
      zone_description: bmoHit.zone_description ?? null,
      zone_code: bmoHit.zone_code ?? null,
      lga: bmoHit.lga ?? null,
      gaz_begin_date: bmoHit.gaz_begin_date ?? null,
    };
  }
  if (bpaHit !== null) {
    evidence.bpa = {
      plan_number: bpaHit.plan_number ?? null,
      gazettal_date: bpaHit.gazettal_date ?? null,
      lga_name: bpaHit.lga_name ?? null,
    };
  }

  return {
    category: 'bushfire',
    severity,
    description,
    dataAvailable: true,
    sourceRef: {
      provider: 'overlays',
      endpoint: BUSHFIRE_ENDPOINT,
      fetchedAt: new Date().toISOString(),
      path: '/risks/bushfire',
    },
    evidence: JSON.stringify(evidence),
  };
}
