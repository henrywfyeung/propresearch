// src/tools/schools/catchments.ts — which GOVERNMENT school is the subject address
// zoned for (its catchment / intake zone), distinct from the "nearby schools"
// proximity list. Point-in-polygon against bundled, simplified GeoJSON built once
// by scripts/build-catchments.sh from two open datasets (§4.3):
//   NSW — NSW Dept of Education School Intake Zones (CC BY). school + catchType.
//   VIC — VIC Dept of Education School Zones (CC BY 4.0). school only; secondary
//         is the Year-7 (entry) integrated zone.
//
// The .geojson.gz files load lazily and cache per (state, level) for the process.
// Fully graceful: missing file / parse error / non-NSW-VIC / no enclosing polygon
// all yield nulls — the report renders without the block.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { logger } from '@/lib/observability/logger';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

export type CatchmentLevel = 'primary' | 'secondary';

export interface CatchmentMatch {
  school: string;
  level: CatchmentLevel;
  /** NSW only: PRIMARY | HIGH_COED | HIGH_BOYS | HIGH_GIRLS | CENTRAL_HIGH. Null for VIC. */
  catchType: string | null;
}

export interface SchoolCatchments {
  primary: CatchmentMatch | null;
  secondary: CatchmentMatch | null;
}

type ZoneProps = { school?: string; catchType?: string | null };
type ZoneFC = FeatureCollection<Polygon | MultiPolygon, ZoneProps>;

const EMPTY: SchoolCatchments = { primary: null, secondary: null };
const cache = new Map<string, ZoneFC | null>();

function loadLayer(state: 'NSW' | 'VIC', level: CatchmentLevel): ZoneFC | null {
  const key = `${state}-${level}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let fc: ZoneFC | null = null;
  try {
    const file = join(
      process.cwd(),
      'src/data/catchments',
      `${state.toLowerCase()}-${level}.geojson.gz`,
    );
    fc = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as ZoneFC;
  } catch (err) {
    logger.warn({ err: String(err), state, level }, 'catchments: layer load failed');
  }
  cache.set(key, fc);
  return fc;
}

function firstMatch(
  fc: ZoneFC,
  lng: number,
  lat: number,
  level: CatchmentLevel,
): CatchmentMatch | null {
  for (const f of fc.features as Feature<Polygon | MultiPolygon, ZoneProps>[]) {
    if (!f.geometry || !f.properties?.school) continue;
    if (booleanPointInPolygon([lng, lat], f.geometry)) {
      return { school: f.properties.school, level, catchType: f.properties.catchType ?? null };
    }
  }
  return null;
}

/**
 * The government primary + secondary school the (lat,lng) is zoned for. Returns
 * nulls for non-NSW/VIC, unreadable data, or addresses with no enclosing zone.
 */
export function findCatchments(lat: number, lng: number, state: string): SchoolCatchments {
  if (state !== 'NSW' && state !== 'VIC') return EMPTY;
  const primaryFc = loadLayer(state, 'primary');
  const secondaryFc = loadLayer(state, 'secondary');
  return {
    primary: primaryFc ? firstMatch(primaryFc, lng, lat, 'primary') : null,
    secondary: secondaryFc ? firstMatch(secondaryFc, lng, lat, 'secondary') : null,
  };
}
