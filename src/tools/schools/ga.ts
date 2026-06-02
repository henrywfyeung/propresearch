// src/tools/schools/ga.ts — Nearby schools + early-education facilities from
// Geoscience Australia's national open "Education_Facilities" layer (CC BY 4.0,
// no third-party/residency/derivative restrictions — §4.3). One national source
// with point geometry; covers NSW + VIC (+ QLD/TAS).
//
// The layer tags everything generically (featuresubtype 120003, category null),
// so facility TYPE is inferred from the name (AU school naming is fairly regular).
// School coverage is strong; early-education (childcare/kinder/preschool) coverage
// is partial in this dataset — callers must frame it as "recorded by GA", not
// exhaustive (the complete childcare register is ACECQA, which lacks a spatial API).

import { type LatLng, haversineMeters } from '@/lib/geo';
import { logger } from '@/lib/observability/logger';
import { z } from 'zod';

const GA_EDUCATION_URL =
  'https://services.ga.gov.au/gis/rest/services/Foundation_Facilities_Points/MapServer/0/query';
// Layer 1 = Health_and_Medical_Facilities; main_function ∈ {Hospital, Aged Care
// Facility, Nursing Home, …} → we filter to Hospital.
const GA_HEALTH_URL =
  'https://services.ga.gov.au/gis/rest/services/Foundation_Facilities_Points/MapServer/1/query';

export type FacilityType = 'primary' | 'secondary' | 'combined' | 'early-education' | 'school';

export interface NearbyFacility {
  name: string;
  type: FacilityType;
  lat: number;
  lng: number;
  distanceM: number;
}

/**
 * Classify a facility from its name. Order matters: early-education and explicit
 * secondary/primary markers are checked before the generic "college"/"school".
 */
/** Tertiary / non-school education facilities to exclude (not primary/secondary/childcare). */
export function isTertiary(rawName: string): boolean {
  return /\bTAFE\b|INSTITUTE OF|\bUNIVERSITY\b|POLYTECHNIC|ADULT (EDUCATION|MIGRANT)|LANGUAGE (CENTRE|SCHOOL)/.test(
    rawName.toUpperCase(),
  );
}

export function classifyFacility(rawName: string): FacilityType {
  const n = rawName.toUpperCase();
  if (/CHILD ?CARE|EARLY LEARN|EARLY EDUC|KINDER|PRE-?SCHOOL|MONTESSORI|\bELC\b|CHILDREN'?S CENTRE|OCCASIONAL CARE/.test(n))
    return 'early-education';
  if (/PREPARATORY|PREP SCHOOL|JUNIOR SCHOOL|INFANTS?\b/.test(n)) return 'primary';
  if (/\bP-?12\b|\bK-?12\b|\bPREP-?12\b|\b7-?12\b|COMBINED/.test(n)) return 'combined';
  if (/HIGH SCHOOL|SECONDARY|\bSENIOR\b/.test(n)) return 'secondary';
  if (/PRIMARY|PUBLIC SCHOOL|\bP\.?S\.?\b/.test(n)) return 'primary';
  if (/COLLEGE|GRAMMAR/.test(n)) return 'secondary'; // most stand-alone "College"/"Grammar" are secondary
  return 'school'; // unclassified generic school
}

const GaQueryResponse = z.object({
  features: z
    .array(
      z.object({
        attributes: z.object({ name: z.string().nullish() }).passthrough(),
        geometry: z.object({ x: z.number(), y: z.number() }).nullish(),
      }),
    )
    .nullish(),
});

/** A located place (name + coords + straight-line distance from the subject). */
export interface NearbyPlace {
  name: string;
  lat: number;
  lng: number;
  distanceM: number;
}

/**
 * Shared GA ArcGIS point near-query → places sorted nearest-first. Returns [] on
 * any failure (graceful degradation). Coordinates are WGS84 (outSR=4326).
 */
async function queryGaPoints(
  layerUrl: string,
  subject: LatLng,
  radiusM: number,
  where: string,
  logName: string,
): Promise<NearbyPlace[]> {
  const url = new URL(layerUrl);
  url.search = new URLSearchParams({
    where,
    geometry: `${subject.lng},${subject.lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: '4326',
    distance: String(radiusM),
    units: 'esriSRUnit_Meter',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'name',
    returnGeometry: 'true',
    f: 'json',
  }).toString();

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      logger.warn({ status: res.status }, `${logName}: GA returned non-2xx`);
      return [];
    }
    const parsed = GaQueryResponse.parse(await res.json());
    const out: NearbyPlace[] = [];
    for (const f of parsed.features ?? []) {
      const name = f.attributes.name?.trim();
      if (!name || !f.geometry) continue;
      const lat = f.geometry.y;
      const lng = f.geometry.x;
      out.push({ name, lat, lng, distanceM: Math.round(haversineMeters(subject, { lat, lng })) });
    }
    return out.sort((a, b) => a.distanceM - b.distanceM);
  } catch (err) {
    logger.warn({ err: String(err) }, `${logName}: GA fetch failed`);
    return [];
  }
}

/**
 * Education facilities within `radiusM`, classified by type, sorted nearest-first.
 * Tertiary (TAFE/university/etc.) is excluded.
 */
export async function fetchNearbyFacilities(
  subject: LatLng,
  radiusM = 2000,
): Promise<NearbyFacility[]> {
  const places = await queryGaPoints(GA_EDUCATION_URL, subject, radiusM, '1=1', 'fetchNearbyFacilities');
  return places
    .filter((p) => !isTertiary(p.name))
    .map((p) => ({ ...p, type: classifyFacility(p.name) }));
}

/**
 * Hospitals within `radiusM` (default 5km — hospitals are sparser than schools),
 * sorted nearest-first. Uses GA's `main_function = 'Hospital'` classification
 * (excludes aged-care / nursing homes).
 */
export async function fetchNearbyHospitals(subject: LatLng, radiusM = 5000): Promise<NearbyPlace[]> {
  return queryGaPoints(
    GA_HEALTH_URL,
    subject,
    radiusM,
    "main_function = 'Hospital'",
    'fetchNearbyHospitals',
  );
}
