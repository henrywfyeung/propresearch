// src/tools/nsw-risk/lga.ts
// Resolves the NSW Local Government Area (LGA) name for a given coordinate.
//
// Data source: Common/Admin_3857/MapServer — layer 1 "Local Government Area"
// Host: https://mapprod3.environment.nsw.gov.au/arcgis/rest/services (NSW DCCEEW/SEED)
// Keyless (no token), CORS open, HTTPS.
// Probed 2026-06-01: returns LGANAME (uppercase string, e.g. "WOLLONGONG").
//
// Used by queryFlood (flood.ts) to disambiguate an empty flood result:
//   - If the LGA is in the covered set → "no flood constraint found" (data available)
//   - If the LGA is unknown / null    → "data not published for this LGA" (data unavailable)

import { z } from 'zod';
import { arcgisPointQuery } from './arcgis';

// ---------------------------------------------------------------------------
// Layer config — verified 2026-06-01 via MapServer?f=json introspection.
// Service Common/Admin_3857, layer 1 = "Local Government Area".
// layerId override used because layerName resolution in a 20+ layer service
// is slower; the ID is stable for this service.
// ---------------------------------------------------------------------------

const LGA_SERVICE = 'Common/Admin_3857';
const LGA_LAYER_NAME = 'Local Government Area'; // id 1 in the MapServer
const LGA_LAYER_ID = 1;

// ---------------------------------------------------------------------------
// ArcGIS attribute schema — only the LGANAME field is needed
// ---------------------------------------------------------------------------

const LgaAttributesSchema = z.object({
  LGANAME: z.string(),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the NSW LGA name for the given WGS84 coordinates.
 *
 * Returns the LGANAME string in UPPERCASE (e.g. "WOLLONGONG", "HORNSBY"),
 * matching the keys in `COVERED_FLOOD_LGAS` in flood.ts.
 *
 * Returns `null` when the point does not intersect any NSW LGA polygon
 * (e.g. coordinates in VIC/QLD or in the ocean).
 */
export async function resolveLga(lat: number, lng: number): Promise<string | null> {
  const features = await arcgisPointQuery(
    {
      service: LGA_SERVICE,
      layerName: LGA_LAYER_NAME,
      layerId: LGA_LAYER_ID,
      lat,
      lng,
      outFields: ['LGANAME'],
    },
    LgaAttributesSchema,
  );

  if (features.length === 0) return null;

  // LGANAME is already stored uppercase in this layer (e.g. "WOLLONGONG").
  // Uppercase anyway as a belt-and-braces guard.
  return features[0]!.LGANAME.toUpperCase();
}
