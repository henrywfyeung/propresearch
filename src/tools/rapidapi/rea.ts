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
  type: z.string().optional(),
  display: z.object({ text: z.string(), subtext: z.string().optional() }).optional(),
  source: z
    .object({ name: z.string(), postcode: z.string().optional(), state: z.string().optional() })
    .optional(),
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
  images: z.array(z.object({ server: z.string(), uri: z.string() })).nullish(),
  mainImage: z.object({ server: z.string(), uri: z.string() }).nullish(),
});
export type ReaSoldListing = z.infer<typeof ReaSoldListingSchema>;

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
