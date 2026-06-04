// tests/unit/schools.test.ts — GA Education_Facilities adapter: name→type
// classification, tertiary exclusion, and the spatial near-query parsing.

import {
  classifyFacility,
  fetchNearbyFacilities,
  fetchNearbyHospitals,
  isTertiary,
} from '@/tools/schools/ga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('classifyFacility', () => {
  it('classifies early-education from childcare/kinder/preschool names', () => {
    expect(classifyFacility('Little Stars Early Learning Centre')).toBe('early-education');
    expect(classifyFacility('Richmond Kindergarten')).toBe('early-education');
    expect(classifyFacility('ABC Child Care')).toBe('early-education');
    expect(classifyFacility('Sunshine Preschool')).toBe('early-education');
  });

  it('classifies secondary from high/secondary/senior + standalone college', () => {
    expect(classifyFacility('Richmond High School')).toBe('secondary');
    expect(classifyFacility('Brunswick Secondary College')).toBe('secondary');
    expect(classifyFacility('Melbourne Girls Grammar')).toBe('secondary');
  });

  it('classifies primary from primary/public/prep/junior/infants', () => {
    expect(classifyFacility('Richmond Primary School')).toBe('primary');
    expect(classifyFacility('Mosman Public School')).toBe('primary');
    expect(classifyFacility('Queenwood Junior School')).toBe('primary');
    expect(classifyFacility('Mosman Church of England Preparatory School')).toBe('primary');
  });

  it('classifies combined for P-12 / K-12', () => {
    expect(classifyFacility('Haileybury P-12 College')).toBe('combined');
  });

  it('falls back to generic "school" for unclassifiable names', () => {
    expect(classifyFacility('Lynall Hall Community School')).toBe('school');
  });

  it('flags tertiary (TAFE / university / institute), which the fetcher drops', () => {
    expect(isTertiary('Kangan Batman Institute of TAFE - Richmond Campus')).toBe(true);
    expect(isTertiary('RMIT University')).toBe(true);
    expect(isTertiary('Richmond Primary School')).toBe(false);
  });
});

const SUBJECT = { lat: -37.8243, lng: 144.9945 };

function gaResponse(features: { name: string; x: number; y: number }[]) {
  return {
    ok: true,
    json: async () => ({
      features: features.map((f) => ({
        attributes: { name: f.name },
        geometry: { x: f.x, y: f.y },
      })),
    }),
  } as unknown as Response;
}

describe('fetchNearbyFacilities', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('parses, classifies, excludes tertiary, and sorts nearest-first', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      gaResponse([
        { name: 'FAR HIGH SCHOOL', x: 145.02, y: -37.84 }, // ~2km-ish
        { name: 'NEAR PRIMARY SCHOOL', x: 144.995, y: -37.825 }, // ~150m
        { name: 'KANGAN INSTITUTE OF TAFE', x: 144.996, y: -37.824 }, // tertiary → dropped
      ]),
    );

    const out = await fetchNearbyFacilities(SUBJECT, 2000);

    expect(out.map((f) => f.name)).toEqual(['NEAR PRIMARY SCHOOL', 'FAR HIGH SCHOOL']); // tertiary gone, sorted
    expect(out[0]?.type).toBe('primary');
    expect(out[1]?.type).toBe('secondary');
    expect(out[0]?.distanceM).toBeLessThan(out[1]?.distanceM ?? 0);
  });

  it('returns [] on a non-2xx response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    expect(await fetchNearbyFacilities(SUBJECT)).toEqual([]);
  });

  it('returns [] when fetch throws', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('network'));
    expect(await fetchNearbyFacilities(SUBJECT)).toEqual([]);
  });
});

describe('fetchNearbyHospitals', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('returns hospital places sorted nearest-first (no type classification)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      gaResponse([
        { name: 'FAR HOSPITAL', x: 145.04, y: -37.86 },
        { name: 'EPWORTH RICHMOND', x: 144.996, y: -37.824 },
      ]),
    );
    const out = await fetchNearbyHospitals(SUBJECT, 5000);
    expect(out.map((h) => h.name)).toEqual(['EPWORTH RICHMOND', 'FAR HOSPITAL']);
    expect(out[0]).not.toHaveProperty('type'); // hospitals are plain places
  });

  it('sends a main_function=Hospital filter to GA', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(gaResponse([]));
    await fetchNearbyHospitals(SUBJECT);
    const url = String(vi.mocked(global.fetch).mock.calls[0]?.[0]);
    // URLSearchParams encodes spaces as '+', which decodeURIComponent leaves as-is.
    const decoded = decodeURIComponent(url).replace(/\+/g, ' ');
    expect(decoded).toContain("main_function = 'Hospital'");
  });

  it('returns [] on failure', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('network'));
    expect(await fetchNearbyHospitals(SUBJECT)).toEqual([]);
  });
});
