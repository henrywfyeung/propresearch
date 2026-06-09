// src/tools/rapidapi/rea.ts
// Adapter for the realty-base-au (realestate.com.au) RapidAPI proxy.
// Search-only: /auto-complete (location resolution) + /properties/search
// (channel=sold for comps). Spec §3-§4.

import { z } from 'zod';
import { rapidApiCall } from './client';

export const REA_HOST = process.env.RAPIDAPI_REA_HOST ?? 'realty-base-au.p.rapidapi.com';

// --- auto-complete ------------------------------------------------------
const ReaAutoCompleteItem = z.object({
  locationId: z.string(), // e.g. "suburb:Mosman, NSW 2088"
  type: z.string().nullish(),
  id: z.string().nullish(), // listing id, e.g. "151106864"
  display: z.object({ text: z.string(), subtext: z.string().optional() }).optional(),
  // For type='suburb'/'address' the source is { name, postcode, state }.
  // For type='listing' the source is { url, image, channel }.
  // We capture what we need from both shapes (all nullish so neither shape rejects).
  source: z
    .object({
      name: z.string().nullish(),
      postcode: z.string().nullish(),
      state: z.string().nullish(),
      url: z.string().nullish(), // canonical REA listing URL
      image: z.string().nullish(), // thumbnail template URL
      channel: z.string().nullish(),
    })
    .nullish(),
});
const ReaAutoCompleteResponse = z.object({
  data: z.array(ReaAutoCompleteItem),
  status: z.boolean().optional(),
});

export type ReaLocation = z.infer<typeof ReaAutoCompleteItem>;

export async function reaAutoComplete(query: string): Promise<ReaLocation[]> {
  const res = await rapidApiCall({
    host: REA_HOST,
    path: '/auto-complete',
    params: { query },
    schema: ReaAutoCompleteResponse,
  });
  return res.data;
}

// --- sold search --------------------------------------------------------
// Strict-but-partial: only the fields the comp normalizer needs. Extra fields
// are ignored. A listing without dateSold is not a usable sold comp.
export const ReaSoldListingSchema = z.object({
  listingId: z.union([z.string(), z.number()]).transform(String),
  propertyType: z.string().nullish(),
  price: z.object({ display: z.string().optional() }).nullish(),
  dateSold: z.object({ value: z.string().optional(), display: z.string().optional() }).nullish(),
  landSize: z.object({ value: z.number().optional(), unit: z.string().optional() }).nullish(),
  features: z
    .object({
      general: z
        .object({
          bedrooms: z.number().optional(),
          bathrooms: z.number().optional(),
          parkingSpaces: z.number().optional(),
        })
        .partial()
        .optional(),
    })
    .nullish(),
  address: z
    .object({
      streetAddress: z.string().optional(),
      suburb: z.string().optional(),
      state: z.string().optional(),
      postcode: z.string().optional(),
      location: z.object({ latitude: z.number(), longitude: z.number() }).nullish(),
    })
    .nullish(),
  images: z
    .array(z.object({ server: z.string(), uri: z.string(), name: z.string().nullish() }))
    .nullish(),
  mainImage: z
    .object({ server: z.string(), uri: z.string(), name: z.string().nullish() })
    .nullish(),
  // Canonical listing URL. REA returns a relative SEO slug in `prettyUrl`
  // (e.g. "property-apartment-nsw-mosman-151336940") and the absolute form in
  // `_links.prettyUrl.href`. We prefer the absolute href so the PDF deep-links
  // each comp to its own listing page rather than the REA homepage.
  prettyUrl: z.string().nullish(),
  _links: z.object({ prettyUrl: z.object({ href: z.string() }).nullish() }).nullish(),
});
export type ReaSoldListing = z.infer<typeof ReaSoldListingSchema>;

const REA_BASE_URL = 'https://www.realestate.com.au';

/**
 * Resolve a sold listing's canonical realestate.com.au page URL.
 * Prefers the absolute `_links.prettyUrl.href`, then the relative `prettyUrl`
 * slug, and finally the bare-id short form `…/{listingId}` (REA's own
 * `_links.short.href` format). Returns null if nothing usable is present.
 */
export function reaListingUrl(l: ReaSoldListing): string | null {
  const abs = l._links?.prettyUrl?.href;
  if (abs?.startsWith('http')) return abs;
  if (l.prettyUrl) return `${REA_BASE_URL}/${l.prettyUrl.replace(/^\//, '')}`;
  if (l.listingId) return `${REA_BASE_URL}/${l.listingId}`;
  return null;
}

// Lenient envelope — the listing array is validated per-item below.
const ReaSearchResponse = z.object({
  totalResultCount: z.number().optional(),
  currentPage: z.number().optional(),
  data: z.array(z.unknown()),
});

export async function reaSearchSold(locationId: string, page = 1): Promise<ReaSoldListing[]> {
  const res = await rapidApiCall({
    host: REA_HOST,
    path: '/properties/search',
    params: { locationId, channel: 'sold', page },
    schema: ReaSearchResponse,
  });

  const out: ReaSoldListing[] = [];
  for (const item of res.data) {
    const parsed = ReaSoldListingSchema.safeParse(item);
    if (parsed.success && parsed.data.dateSold) out.push(parsed.data);
  }
  return out;
}

// --- listing images (buy channel, for a listing: locationId) ------------

/**
 * Build a size-prefixed CDN URL that returns a real full-resolution JPEG.
 * The bare URL (${server}${uri}) 302-redirects to a placeholder; inserting
 * the size segment before the hash path serves the actual photo.
 */
export function withSize(server: string, uri: string): string {
  return `${server}/1920x1080-format=jpg${uri}`;
}

export type ReaImageItem = { server: string; name: string; uri: string };

// Lenient envelope for the listing-detail endpoint. When the locationId is
// of type 'listing', the API returns data as an object (single listing)
// rather than an array; we normalise to an array of image items.
const ReaListingDetailResponse = z.object({
  status: z.boolean().optional(),
  data: z.union([
    // single listing (the common shape for type=listing locationIds)
    z
      .object({
        images: z
          .array(
            z
              .object({
                server: z.string(),
                name: z.string(),
                uri: z.string(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough(),
    // array shape (just in case)
    z.array(z.unknown()),
  ]),
});

/**
 * Fetch the image array for a listing-type locationId (e.g.
 * "listing:2/25 Mosman Street, Mosman, NSW 2088"). Returns raw image items
 * including server/name/uri; caller uses withSize() to build full URLs.
 * Returns [] on any parse failure so callers degrade gracefully.
 */
export async function reaListingImages(locationId: string): Promise<ReaImageItem[]> {
  const res = await rapidApiCall({
    host: REA_HOST,
    path: '/properties/search',
    params: { locationId, channel: 'buy' },
    schema: ReaListingDetailResponse,
  });

  // data may be a dict (single listing) or an array — normalise.
  const listing = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!listing || Array.isArray(listing)) return [];

  const images = (listing as { images?: unknown }).images;
  if (!Array.isArray(images)) return [];

  const out: ReaImageItem[] = [];
  for (const img of images) {
    if (img && typeof img === 'object' && 'server' in img && 'name' in img && 'uri' in img) {
      const candidate = img as { server: unknown; name: unknown; uri: unknown };
      if (
        typeof candidate.server === 'string' &&
        typeof candidate.name === 'string' &&
        typeof candidate.uri === 'string'
      ) {
        out.push({ server: candidate.server, name: candidate.name, uri: candidate.uri });
      }
    }
  }
  return out;
}
