// src/tools/comps/reaComps.ts
// REA → Comparable normalization + sold-comp assembly. Spec §4-§5.

import { type LatLng, haversineMeters } from '@/lib/geo';
import type { SourceRef } from '@/schemas/sources';
import type { Comparable } from '@/schemas/state';
import { type ReaSoldListing, reaListingUrl, reaSearchSold, withSize } from '@/tools/rapidapi/rea';

// REA propertyType vocab → the canonical vocab similarity scoring expects.
// 'House' is load-bearing: similarityScore only applies the land-area term for
// subject.propertyType === 'House' (src/tools/comps/similarity.ts).
const PROPERTY_TYPE_MAP: Record<string, string> = {
  house: 'House',
  acreage: 'House',
  acreagesemirural: 'House',
  apartment: 'ApartmentUnitFlat',
  unit: 'ApartmentUnitFlat',
  flat: 'ApartmentUnitFlat',
  unitapartment: 'ApartmentUnitFlat',
  townhouse: 'Townhouse',
  villa: 'Villa',
  duplex: 'Townhouse',
  land: 'Land',
  residentialland: 'Land',
};

export function mapReaPropertyType(raw: string | null | undefined): string {
  if (!raw) return 'Other';
  return PROPERTY_TYPE_MAP[raw.toLowerCase().replace(/[^a-z]/g, '')] ?? 'Other';
}

/** Parse a single clean AUD amount; null for ranges / words / withheld. */
export function parseAudPrice(display: string | null | undefined): number | null {
  if (!display) return null;
  const m = display.match(/^\s*\$?\s*([\d,]+)\s*$/) ?? display.match(/\$\s?([\d,]+)/);
  if (!m) return null;
  const n = Number((m[1] ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function landToM2(landSize: ReaSoldListing['landSize']): number | null {
  if (!landSize?.value) return null;
  const u = (landSize.unit ?? 'm2').toLowerCase();
  if (u === 'ha' || u.startsWith('hectare')) return Math.round(landSize.value * 10_000);
  return landSize.value; // m2 / sqm
}

// REA listings can carry a video whose image entry is served from a video host
// (e.g. https://img.youtube.com). withSize() would compose a malformed
// `https://img.youtube.com/1920x1080-format=jpg/vi/<id>/0.jpg` URL that 400s
// when handed to vision — so drop non-image hosts before building photo URLs.
// (The subject path in listingMedia.ts is already safe: it allow-lists
// name==='photo'. Sold-comp `images` aren't reliably name-tagged, so we
// deny-list video hosts instead, which never drops a real REA photo.)
const NON_IMAGE_HOST = /youtube\.com|youtu\.be|vimeo\.com/i;

function photoUrls(l: ReaSoldListing, cap = 8): string[] {
  return (l.images ?? [])
    .filter((i) => !NON_IMAGE_HOST.test(i.server))
    .map((i) => withSize(i.server, i.uri))
    .slice(0, cap);
}

/**
 * Normalize one REA sold listing into a candidate Comparable, or null if it
 * can't serve as a comp (no clean price, no sold date, or no geo). Ranking
 * (similarityScore/selection) is left to the future Node 03.
 */
export function toComparable(l: ReaSoldListing, subject: LatLng): Comparable | null {
  const salePrice = parseAudPrice(l.price?.display);
  const contractDate = l.dateSold?.value ?? null;
  const loc = l.address?.location;
  if (salePrice == null || !contractDate || !loc) return null;

  const g = l.features?.general ?? {};
  const a = l.address ?? {};
  const address = [a.streetAddress, a.suburb, a.state, a.postcode].filter(Boolean).join(', ');

  const source: SourceRef = {
    provider: 'rea',
    endpoint: '/properties/search?channel=sold',
    fetchedAt: new Date().toISOString(),
    // Placeholder index; the consuming node fixes the index when it places the
    // comp into state (the critic resolves final claim paths at compose time).
    path: '/comparables/0/salePrice',
  };

  return {
    id: l.listingId,
    address,
    salePrice,
    contractDate,
    distanceM: haversineMeters(subject, { lat: loc.latitude, lng: loc.longitude }),
    lat: loc.latitude,
    lng: loc.longitude,
    beds: g.bedrooms ?? 0,
    baths: g.bathrooms ?? 0,
    landArea: landToM2(l.landSize),
    propertyType: mapReaPropertyType(l.propertyType),
    photos: photoUrls(l),
    listingUrl: reaListingUrl(l),
    visionAnalysis: null,
    similarityScore: 0,
    selection: 'candidate',
    verdict: null,
    comparison: null,
    adjustments: [],
    adjustedValue: null,
    adjustmentNarrative: null,
    source,
  };
}

// --- sold-comp assembly -------------------------------------------------

export interface FetchReaCompsOpts {
  /** REA locationId, e.g. 'suburb:Mosman, NSW 2088' (from reaAutoComplete). */
  locationId: string;
  /** Subject coordinates (from resolvedAddress) for distance scoring. */
  subject: LatLng;
  /** Sold-within window in days (default 180, per §7.3). */
  withinDays?: number;
  /** Max sold pages to fetch (default 3 → ~75 candidates). */
  maxPages?: number;
}

/**
 * Fetch recent sold comparables for a suburb: paginate the REA sold channel,
 * normalize, drop unusable, filter to `withinDays`, dedupe by id. Returns
 * candidate Comparables (unranked); Node 03 applies similarityScore + selection.
 */
export async function fetchReaSoldComparables(opts: FetchReaCompsOpts): Promise<Comparable[]> {
  const { locationId, subject, withinDays = 180, maxPages = 3 } = opts;
  const cutoff = Date.now() - withinDays * 86_400_000;
  const byId = new Map<string, Comparable>();

  for (let page = 1; page <= maxPages; page++) {
    const listings = await reaSearchSold(locationId, page);
    if (listings.length === 0) break;
    for (const l of listings) {
      const c = toComparable(l, subject);
      if (!c) continue;
      if (new Date(c.contractDate).getTime() < cutoff) continue;
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
  }
  return Array.from(byId.values());
}
