// src/tools/vic-risk/heritage.ts
// VIC heritage risk adapter — queries TWO layers in parallel:
//
//   (a) plan_overlay with scheme_code='HO' (Heritage Overlay — local / state)
//       → severity 'medium'
//   (b) open-data-platform:heritage_register (VHR — Victorian Heritage Register)
//       → severity 'high' (state-significant / statutory protection)
//
// Priority: VHR (high) outranks HO (medium). When both hit, the VHR flag is
// returned with HO detail folded into the evidence. When only one hits, that
// one is returned. When neither hits, returns null.

import type { RiskFlag } from '@/schemas/state';
import { z } from 'zod';
import { vicWfsPointQuery } from './wfs';

// ---------------------------------------------------------------------------
// Layer config
// ---------------------------------------------------------------------------

const PLAN_OVERLAY_TYPE = 'open-data-platform:plan_overlay';
const HERITAGE_REGISTER_TYPE = 'open-data-platform:heritage_register';

const HO_CQL_EXTRA = "scheme_code='HO'";
const HO_PROPERTIES = 'scheme_code,zone_code,zone_description,lga';
const VHR_PROPERTIES = 'vhr_num,site_name,hermes_num';

const VIC_WFS_BASE = process.env.VIC_VICMAP_WFS ?? 'https://opendata.maps.vic.gov.au/geoserver/wfs';
const HERITAGE_ENDPOINT = `${VIC_WFS_BASE}?typeNames=${PLAN_OVERLAY_TYPE},${HERITAGE_REGISTER_TYPE}`;

// ---------------------------------------------------------------------------
// Attribute schemas
// ---------------------------------------------------------------------------

const HoOverlaySchema = z.object({
  scheme_code: z.string(),
  zone_code: z.string().nullable().optional(),
  zone_description: z.string().nullable().optional(),
  lga: z.string().nullable().optional(),
});

type HoOverlay = z.infer<typeof HoOverlaySchema>;

const VhrSchema = z.object({
  vhr_num: z.string().nullable().optional(),
  site_name: z.string().nullable().optional(),
  // The live WFS returns hermes_num as a NUMBER (e.g. 228) — accept either form.
  hermes_num: z.union([z.string(), z.number()]).nullable().optional(),
});

type VhrFeature = z.infer<typeof VhrSchema>;

// ---------------------------------------------------------------------------
// Flag builders
// ---------------------------------------------------------------------------

function buildVhrFlag(vhr: VhrFeature, ho: HoOverlay | null): RiskFlag {
  const evidence: Record<string, unknown> = {
    vhr: {
      vhr_num: vhr.vhr_num ?? null,
      hermes_num: vhr.hermes_num ?? null,
    },
  };
  if (ho !== null) {
    evidence.ho = {
      zone_code: ho.zone_code ?? null,
    };
  }

  return {
    category: 'heritage',
    severity: 'high',
    description: vhr.site_name ?? `VHR ${vhr.vhr_num ?? 'entry'}`,
    dataAvailable: true,
    sourceRef: {
      provider: 'overlays',
      endpoint: HERITAGE_ENDPOINT,
      fetchedAt: new Date().toISOString(),
      path: '/risks/heritage',
    },
    evidence: JSON.stringify(evidence),
  };
}

function buildHoFlag(ho: HoOverlay): RiskFlag {
  return {
    category: 'heritage',
    severity: 'medium',
    description: ho.zone_description ?? `Heritage Overlay (${ho.zone_code ?? 'HO'})`,
    dataAvailable: true,
    sourceRef: {
      provider: 'overlays',
      endpoint: HERITAGE_ENDPOINT,
      fetchedAt: new Date().toISOString(),
      path: '/risks/heritage',
    },
    evidence: JSON.stringify({
      ho: {
        zone_code: ho.zone_code ?? null,
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query both VIC heritage layers in parallel.
 *
 * VHR (heritage_register) → severity 'high', outranks HO.
 * HO (plan_overlay scheme_code='HO') → severity 'medium'.
 * Neither → null.
 *
 * @param lat WGS84 latitude
 * @param lng WGS84 longitude
 * @returns Merged RiskFlag (VHR if present, else HO), or null when neither layer intersects.
 */
export async function queryVicHeritage(lat: number, lng: number): Promise<RiskFlag | null> {
  const [hoFeatures, vhrFeatures] = await Promise.all([
    vicWfsPointQuery(
      {
        typeName: PLAN_OVERLAY_TYPE,
        lat,
        lng,
        propertyName: HO_PROPERTIES,
        cqlExtra: HO_CQL_EXTRA,
      },
      HoOverlaySchema,
    ),
    vicWfsPointQuery(
      {
        typeName: HERITAGE_REGISTER_TYPE,
        lat,
        lng,
        propertyName: VHR_PROPERTIES,
      },
      VhrSchema,
    ),
  ]);

  const hoHit: HoOverlay | null = hoFeatures[0] ?? null;
  const vhrHit: VhrFeature | null = vhrFeatures[0] ?? null;

  if (vhrHit !== null) {
    // VHR outranks HO — return VHR flag, fold HO detail into evidence
    return buildVhrFlag(vhrHit, hoHit);
  }

  if (hoHit !== null) {
    return buildHoFlag(hoHit);
  }

  return null;
}
