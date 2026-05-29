// Street View image fetch (Node 04c input). Pulls all four headings; a
// no-imagery heading (Google returns a non-200 with return_error_code=true)
// yields null for that slot so the node can degrade gracefully (§7.17).

import { logger } from '@/lib/observability/logger';
import { STREET_VIEW_HEADINGS, streetviewUrl } from './url';

export interface StreetViewImage {
  heading: number;
  bytes: Buffer | null; // null = no imagery available for this heading
}

export async function fetchStreetViewImages(lat: number, lng: number): Promise<StreetViewImage[]> {
  return Promise.all(
    STREET_VIEW_HEADINGS.map(async (heading) => {
      try {
        const res = await fetch(streetviewUrl(lat, lng, heading));
        if (!res.ok) {
          logger.warn({ heading, status: res.status }, 'street view: no imagery for heading');
          return { heading, bytes: null };
        }
        const buf = Buffer.from(await res.arrayBuffer());
        return { heading, bytes: buf };
      } catch (err) {
        logger.warn({ heading, err: String(err) }, 'street view fetch failed');
        return { heading, bytes: null };
      }
    }),
  );
}
