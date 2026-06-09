// src/agents/nodes/14_fetchSchools.ts — nearby schools + hospitals from Geoscience
// Australia's national open dataset (§4.3). National (no state gate). Fully
// graceful: any failure degrades to an empty list; the graph continues.

import type { GraphState } from '@/agents/annotation';
import { fetchNearbyFacilities, fetchNearbyHospitals } from '@/tools/schools/ga';

const SCHOOL_RADIUS_M = 2000;
const HOSPITAL_RADIUS_M = 5000; // hospitals are sparser than schools
const MAX_HOSPITALS = 8; // keep state lean; the report shows the nearest few

export async function fetchSchools(state: GraphState): Promise<Partial<GraphState>> {
  if (!state.resolvedAddress) {
    return { errors: [{ code: 'PARTIAL_DATA', message: 'fetchSchools: no resolvedAddress' }] };
  }
  const { lat, lng } = state.resolvedAddress;
  const [schools, hospitals] = await Promise.all([
    fetchNearbyFacilities({ lat, lng }, SCHOOL_RADIUS_M).catch(() => []),
    fetchNearbyHospitals({ lat, lng }, HOSPITAL_RADIUS_M).catch(() => []),
  ]);
  return { schools, hospitals: hospitals.slice(0, MAX_HOSPITALS) };
}
