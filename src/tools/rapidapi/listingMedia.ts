// src/tools/rapidapi/listingMedia.ts
// Fetches a property's real listing photos and floor-plan CDN URLs from the
// realestate.com.au RapidAPI proxy. This is best-effort enrichment — errors
// are swallowed and null is returned so the graph can continue without photos.

import { logger } from '@/lib/observability/logger';
import { reaAutoComplete, reaListingImages, withSize } from './rea';

export interface ListingMediaResult {
  /** Canonical realestate.com.au URL for the listing. */
  listingUrl: string | null;
  /** Full-resolution JPEG URLs for photos (size-prefixed). */
  photos: string[];
  /** Full-resolution JPEG URLs for floor plans (size-prefixed). */
  floorplans: string[];
}

/**
 * Given a property address, try to find the active listing on REA, then
 * fetch and return its photo + floor-plan CDN URLs with the size segment
 * inserted so the CDN serves a real image (not the placeholder redirect).
 *
 * Returns null if:
 * - The property has no active listing on REA (no type='listing' suggestion).
 * - Any network or parse error occurs (graceful degradation).
 */
export async function fetchListingMedia(address: string): Promise<ListingMediaResult | null> {
  try {
    const suggestions = await reaAutoComplete(address);

    // Find the first suggestion that is a live listing.
    const listingSuggestion = suggestions.find((s) => s.type === 'listing');
    if (!listingSuggestion) {
      logger.info({ address }, 'fetchListingMedia: no listing suggestion found');
      return null;
    }

    const images = await reaListingImages(listingSuggestion.locationId);

    const photos = images
      .filter((img) => img.name === 'photo' || img.name === 'main photo')
      .map((img) => withSize(img.server, img.uri));

    const floorplans = images
      .filter((img) => img.name === 'floorplan')
      .map((img) => withSize(img.server, img.uri));

    return {
      listingUrl: listingSuggestion.source?.url ?? null,
      photos,
      floorplans,
    };
  } catch (err) {
    logger.warn({ address, err }, 'fetchListingMedia: error fetching listing media, degrading');
    return null;
  }
}
