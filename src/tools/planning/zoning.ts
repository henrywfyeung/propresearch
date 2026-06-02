// src/tools/planning/zoning.ts — residential zoning + planning overlays for the
// subject, from open gov data (§4.3):
//   VIC → Vicmap WFS plan_zone (zone) + plan_overlay (all overlays: HO/SCO/ESO/DDO…)
//   NSW → EPI_Primary_Planning_Layers MapServer (Land Zoning); heritage already
//         surfaces in the risk register, so NSW overlays beyond zone are deferred.
// Fully graceful: any failure → nulls/empty; the graph continues.

import { logger } from '@/lib/observability/logger';
import { arcgisPointQuery } from '@/tools/nsw-risk/arcgis';
import { vicWfsPointQuery } from '@/tools/vic-risk/wfs';
import { z } from 'zod';

export interface PlanningOverlay {
  code: string;
  description: string;
}
export interface PlanningControls {
  zoneCode: string | null;
  zoneDescription: string | null;
  overlays: PlanningOverlay[];
}

const EMPTY: PlanningControls = { zoneCode: null, zoneDescription: null, overlays: [] };

// --- VIC (Vicmap WFS) -------------------------------------------------------
const VicPlanProps = z.object({
  zone_code: z.string().nullish(),
  zone_description: z.string().nullish(),
});

async function fetchVic(lat: number, lng: number): Promise<PlanningControls> {
  const [zoneRes, overlayRes] = await Promise.allSettled([
    vicWfsPointQuery(
      { typeName: 'open-data-platform:plan_zone', lat, lng, propertyName: 'zone_code,zone_description' },
      VicPlanProps,
    ),
    vicWfsPointQuery(
      { typeName: 'open-data-platform:plan_overlay', lat, lng, propertyName: 'zone_code,zone_description' },
      VicPlanProps,
    ),
  ]);

  const zone = zoneRes.status === 'fulfilled' ? zoneRes.value[0] : null;
  if (zoneRes.status === 'rejected')
    logger.warn({ err: String(zoneRes.reason) }, 'zoning(VIC): plan_zone failed');

  const overlays: PlanningOverlay[] = [];
  if (overlayRes.status === 'fulfilled') {
    const seen = new Set<string>();
    for (const o of overlayRes.value) {
      const code = o.zone_code?.trim();
      if (!code || seen.has(code)) continue;
      seen.add(code);
      overlays.push({ code, description: o.zone_description?.trim() || code });
    }
  } else {
    logger.warn({ err: String(overlayRes.reason) }, 'zoning(VIC): plan_overlay failed');
  }

  return {
    zoneCode: zone?.zone_code ?? null,
    zoneDescription: zone?.zone_description ?? null,
    overlays,
  };
}

// --- NSW (EPI_Primary_Planning_Layers MapServer) ----------------------------
const NswZoneAttrs = z.object({
  SYM_CODE: z.string().nullish(),
  LAY_CLASS: z.string().nullish(),
});

async function fetchNsw(lat: number, lng: number): Promise<PlanningControls> {
  const rows = await arcgisPointQuery(
    {
      service: 'Planning/EPI_Primary_Planning_Layers',
      layerName: 'Land Zoning',
      layerId: 2,
      lat,
      lng,
      outFields: ['SYM_CODE', 'LAY_CLASS'],
    },
    NswZoneAttrs,
  ).catch((err: unknown) => {
    logger.warn({ err: String(err) }, 'zoning(NSW): EPI Land Zoning failed');
    return [] as z.infer<typeof NswZoneAttrs>[];
  });

  const zone = rows[0];
  // NSW heritage overlay is already reported in the risk register, so we don't
  // duplicate it here; zone is the primary NSW planning-control field.
  return {
    zoneCode: zone?.SYM_CODE ?? null,
    zoneDescription: zone?.LAY_CLASS ?? null,
    overlays: [],
  };
}

/**
 * Fetch the subject's zoning + overlays. NSW + VIC only (matches the rest of the
 * pipeline); other regions return empty controls.
 */
export async function fetchPlanningControls(
  lat: number,
  lng: number,
  region: string,
): Promise<PlanningControls> {
  try {
    if (region === 'VIC') return await fetchVic(lat, lng);
    if (region === 'NSW') return await fetchNsw(lat, lng);
  } catch (err) {
    logger.warn({ err: String(err), region }, 'fetchPlanningControls failed');
  }
  return EMPTY;
}
