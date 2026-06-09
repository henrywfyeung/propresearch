// src/tools/nsw-risk/heritage.ts
// Heritage risk adapter — queries two NSW heritage layers in parallel:
//   (a) State Heritage Register (SHR) polygon layer — HMS/Heritage, layer id 6
//   (b) LEP/local heritage + conservation areas — Planning/EPI_Primary_Planning_Layers, layer 0
//
// Returns a single RiskFlag (the more significant of the two), or null when
// neither layer intersects the point.
//
// Priority: SHR always outranks LEP/local (spec §1 "SHR outranks LEP").
// When both hit, the SHR-based flag is returned with LEP detail folded into
// the evidence JSON. When only one hits, that one is used. When neither hits,
// the caller (Node 09) wraps null → 'None identified' informational flag.
//
// NOTE: SHR layer-id hardcoded to 6 (polygon layer).
// HMS/Heritage has *two* layers named "State Heritage Register":
//   id 5 — esriGeometryPoint  (centroids; point-in-polygon query never matches)
//   id 6 — esriGeometryPolygon (curtilage polygons; this is what we want)
// arcgisPointQuery's find() would return id 5 (first match), so we bypass
// name-resolution by providing layerId: 6 directly. Verified live 2026-06-01.
// TODO: Remove the layerId override if the service renames the layers.

import type { RiskFlag } from '@/schemas/state';
import { z } from 'zod';
import { arcgisPointQuery } from './arcgis';

// ---------------------------------------------------------------------------
// Layer config — verified 2026-06-01 via MapServer?f=json introspection
// ---------------------------------------------------------------------------

const SHR_SERVICE = 'HMS/Heritage';
// Name is shared with the points layer (id 5); use layerId override to target polygons.
const SHR_LAYER_NAME = 'State Heritage Register';
const SHR_POLYGON_LAYER_ID = 6;

const EPI_SERVICE = 'Planning/EPI_Primary_Planning_Layers';
const EPI_LAYER_NAME = 'Heritage'; // layer 0, unique name

// ---------------------------------------------------------------------------
// ArcGIS attribute schemas
// ---------------------------------------------------------------------------

const ShrAttributesSchema = z.object({
  ITEMNAME: z.string(),
  ADDRESS: z.string(),
  LGA: z.string(),
  LISTING: z.string(),
  LISTINGNO: z.string(),
  TYPE: z.string(),
});

type ShrAttributes = z.infer<typeof ShrAttributesSchema>;

const EpiAttributesSchema = z.object({
  H_NAME: z.string(),
  SIG: z.string(),
  LAY_CLASS: z.string(),
  H_ID: z.string(),
  EPI_NAME: z.string(),
  EPI_TYPE: z.string(),
});

type EpiAttributes = z.infer<typeof EpiAttributesSchema>;

// ---------------------------------------------------------------------------
// Severity mapping for LEP/EPI layer
// ---------------------------------------------------------------------------

type Heritage_Severity = 'high' | 'medium';

function epiSigToSeverity(sig: string): Heritage_Severity {
  const upper = sig.toUpperCase();
  if (
    upper === 'STATE' ||
    upper === 'NATIONAL' ||
    upper === 'WORLD' ||
    upper.startsWith('STATE/') ||
    upper.endsWith('/STATE')
  ) {
    return 'high';
  }
  return 'medium'; // 'Local' and anything else defaults to medium
}

// ---------------------------------------------------------------------------
// Flag builders
// ---------------------------------------------------------------------------

function buildShrFlag(
  attr: ShrAttributes,
  endpointUrl: string,
  lepAttr: EpiAttributes | null,
): RiskFlag {
  const evidenceBase = {
    listing: attr.LISTING,
    listingNo: attr.LISTINGNO,
    type: attr.TYPE,
    address: attr.ADDRESS,
    ...(lepAttr !== null
      ? {
          lepName: lepAttr.EPI_NAME,
          lepSig: lepAttr.SIG,
          lepLayClass: lepAttr.LAY_CLASS,
        }
      : {}),
  };

  return {
    category: 'heritage',
    severity: 'high',
    description: `${attr.ITEMNAME} (SHR ${attr.LISTINGNO}, ${attr.TYPE})`,
    dataAvailable: true,
    sourceRef: {
      provider: 'overlays',
      endpoint: endpointUrl,
      fetchedAt: new Date().toISOString(),
      path: '/risks/heritage',
    },
    evidence: JSON.stringify(evidenceBase),
  };
}

function buildEpiFlag(attr: EpiAttributes, endpointUrl: string): RiskFlag {
  return {
    category: 'heritage',
    severity: epiSigToSeverity(attr.SIG),
    description: `${attr.H_NAME} — ${attr.LAY_CLASS} (${attr.SIG}), ${attr.EPI_NAME}`,
    dataAvailable: true,
    sourceRef: {
      provider: 'overlays',
      endpoint: endpointUrl,
      fetchedAt: new Date().toISOString(),
      path: '/risks/heritage',
    },
    evidence: JSON.stringify({
      sig: attr.SIG,
      layClass: attr.LAY_CLASS,
      hId: attr.H_ID,
      epi: attr.EPI_NAME,
    }),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query both NSW heritage layers for the given coordinates in parallel.
 *
 * @param lat WGS84 latitude
 * @param lng WGS84 longitude
 * @returns RiskFlag when one or both layers intersect the point; null when
 *   neither hits.
 */
export async function queryHeritage(lat: number, lng: number): Promise<RiskFlag | null> {
  const arcgisBase =
    process.env.NSW_ARCGIS_BASE ?? 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services';

  const shrEndpointUrl = `${arcgisBase}/${SHR_SERVICE}/MapServer/${SHR_POLYGON_LAYER_ID}/query`;
  const epiEndpointUrl = `${arcgisBase}/${EPI_SERVICE}/MapServer/0/query`;

  // Run both queries in parallel
  const [shrFeatures, epiFeatures] = await Promise.all([
    arcgisPointQuery(
      {
        service: SHR_SERVICE,
        layerName: SHR_LAYER_NAME,
        layerId: SHR_POLYGON_LAYER_ID,
        lat,
        lng,
        outFields: ['ITEMNAME', 'ADDRESS', 'LGA', 'LISTING', 'LISTINGNO', 'TYPE'],
      },
      ShrAttributesSchema,
    ),
    arcgisPointQuery(
      {
        service: EPI_SERVICE,
        layerName: EPI_LAYER_NAME,
        lat,
        lng,
        outFields: ['H_NAME', 'SIG', 'LAY_CLASS', 'H_ID', 'EPI_NAME', 'EPI_TYPE'],
      },
      EpiAttributesSchema,
    ),
  ]);

  const shrHit = shrFeatures[0] ?? null;
  const epiHit = epiFeatures[0] ?? null;

  if (shrHit !== null) {
    // SHR outranks LEP — return SHR flag, fold LEP detail into evidence
    return buildShrFlag(shrHit, shrEndpointUrl, epiHit);
  }

  if (epiHit !== null) {
    return buildEpiFlag(epiHit, epiEndpointUrl);
  }

  return null;
}
