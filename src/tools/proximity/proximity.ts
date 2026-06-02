// src/tools/proximity/proximity.ts — proximity to negative-externality infrastructure:
//   • high-voltage transmission lines — Geoscience Australia National_Electricity_
//     Infrastructure (open, national, polyline; carries kV + name)
//   • freeways/motorways — OpenStreetMap via Overpass (needs a User-Agent)
//
// Returns the nearest of each within a sensible radius (beyond which it's not a
// "proximity" concern), with distance + a label + the nearest-point coords. The
// coords are kept deliberately (web-ready: a future interactive map can draw a
// connector / highlight the feature) — but we DON'T store full line geometry in
// state (it would bloat the snapshot; the web layer re-queries on demand).

import { type LatLng, haversineMeters } from '@/lib/geo';
import { logger } from '@/lib/observability/logger';
import { z } from 'zod';

const GA_TRANSMISSION_URL =
  'https://services.ga.gov.au/gis/rest/services/National_Electricity_Infrastructure/MapServer/2/query';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const TRANSMISSION_RADIUS_M = 25_000; // transmission is sparse; >25km isn't "nearby"
const FREEWAY_RADIUS_M = 8_000;

export interface NearestFeature {
  /** Straight-line distance from the subject, metres. */
  distanceM: number;
  /** Human label — e.g. "220 kV (Rowville–Templestowe)" or "M3". */
  label: string;
  /** Nearest-point coords on the feature (web-ready: draw a connector). */
  lat: number;
  lng: number;
}

export interface ProximityHazards {
  transmissionLine: NearestFeature | null;
  freeway: NearestFeature | null;
}

/** Min straight-line distance (+ the nearest vertex) from `subject` to a list of [lng,lat] paths. */
function nearestOnPaths(
  subject: LatLng,
  paths: [number, number][][],
): { distanceM: number; lat: number; lng: number } | null {
  let best: { distanceM: number; lat: number; lng: number } | null = null;
  for (const path of paths) {
    for (const [lng, lat] of path) {
      const distanceM = haversineMeters(subject, { lat, lng });
      if (!best || distanceM < best.distanceM) best = { distanceM: Math.round(distanceM), lat, lng };
    }
  }
  return best;
}

const GaLineResponse = z.object({
  features: z
    .array(
      z.object({
        attributes: z
          .object({ name: z.string().nullish(), capacitykv: z.union([z.number(), z.string()]).nullish() })
          .passthrough(),
        geometry: z.object({ paths: z.array(z.array(z.tuple([z.number(), z.number()]))) }).nullish(),
      }),
    )
    .nullish(),
});

/** Nearest high-voltage transmission line within {@link TRANSMISSION_RADIUS_M}, or null. */
export async function fetchNearestTransmission(subject: LatLng): Promise<NearestFeature | null> {
  const url = new URL(GA_TRANSMISSION_URL);
  url.search = new URLSearchParams({
    geometry: `${subject.lng},${subject.lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: '4326',
    distance: String(TRANSMISSION_RADIUS_M),
    units: 'esriSRUnit_Meter',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'name,capacitykv',
    returnGeometry: 'true',
    f: 'json',
  }).toString();

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const parsed = GaLineResponse.parse(await res.json());
    let best: NearestFeature | null = null;
    for (const f of parsed.features ?? []) {
      if (!f.geometry) continue;
      const near = nearestOnPaths(subject, f.geometry.paths);
      if (!near) continue;
      if (!best || near.distanceM < best.distanceM) {
        const kv = f.attributes.capacitykv;
        const name = f.attributes.name?.trim();
        const label = [kv ? `${kv} kV` : null, name].filter(Boolean).join(' · ') || 'Transmission line';
        best = { distanceM: near.distanceM, label, lat: near.lat, lng: near.lng };
      }
    }
    return best;
  } catch (err) {
    logger.warn({ err: String(err) }, 'fetchNearestTransmission: GA query failed');
    return null;
  }
}

const OverpassResponse = z.object({
  elements: z
    .array(
      z.object({
        tags: z.object({ ref: z.string().nullish(), name: z.string().nullish() }).nullish(),
        geometry: z.array(z.object({ lat: z.number(), lon: z.number() })).nullish(),
      }),
    )
    .nullish(),
});

/** Nearest freeway/motorway within {@link FREEWAY_RADIUS_M}, or null. */
export async function fetchNearestFreeway(subject: LatLng): Promise<NearestFeature | null> {
  const query = `[out:json][timeout:25];way["highway"="motorway"](around:${FREEWAY_RADIUS_M},${subject.lat},${subject.lng});out geom;`;
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      // Overpass rejects requests without a User-Agent.
      headers: { 'User-Agent': 'propsearch/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const parsed = OverpassResponse.parse(await res.json());
    let best: NearestFeature | null = null;
    for (const el of parsed.elements ?? []) {
      const paths: [number, number][][] = el.geometry
        ? [el.geometry.map((n) => [n.lon, n.lat] as [number, number])]
        : [];
      const near = nearestOnPaths(subject, paths);
      if (!near) continue;
      if (!best || near.distanceM < best.distanceM) {
        const label = el.tags?.ref?.trim() || el.tags?.name?.trim() || 'Motorway';
        best = { distanceM: near.distanceM, label, lat: near.lat, lng: near.lng };
      }
    }
    return best;
  } catch (err) {
    logger.warn({ err: String(err) }, 'fetchNearestFreeway: Overpass query failed');
    return null;
  }
}

/** Nearest transmission line + freeway (both national; no state gate). */
export async function fetchProximityHazards(subject: LatLng): Promise<ProximityHazards> {
  const [transmissionLine, freeway] = await Promise.all([
    fetchNearestTransmission(subject).catch(() => null),
    fetchNearestFreeway(subject).catch(() => null),
  ]);
  return { transmissionLine, freeway };
}
