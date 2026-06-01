// src/report/fetchImages.ts — Server-side image download helper.
// Mirrors the pattern from src/tools/mapbox/staticMap.ts: fetch each URL
// server-side, convert bytes to a base64 data URL, skip any that fail or
// aren't image/* content, and cap the returned count. The REA CDN is public
// and keyless — a plain fetch is sufficient.
//
// Base64 data URLs are embedded directly in the PDF HTML so Puppeteer doesn't
// need to make network requests at render time (the original bug: only 2 of 6
// photos loaded before networkidle0 fired).

import { logger } from '@/lib/observability/logger';

/**
 * Fetch each URL server-side and return it as a `data:<mime>;base64,…` string.
 * - Skips URLs that return non-2xx or a non-image/* Content-Type.
 * - Skips URLs where the fetch throws (network error, timeout, etc.).
 * - Returns at most `cap` data URLs (applied after filtering failures).
 */
export async function fetchImagesAsDataUrls(urls: string[], cap: number): Promise<string[]> {
  const results: string[] = [];

  for (const url of urls) {
    if (results.length >= cap) break;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        logger.warn({ url, status: res.status }, 'fetchImagesAsDataUrls: non-2xx, skipping');
        continue;
      }

      const contentType = res.headers.get('content-type') ?? '';
      // Accept any image/* MIME type (jpeg, png, webp, gif, …).
      if (!contentType.startsWith('image/')) {
        logger.warn(
          { url, contentType },
          'fetchImagesAsDataUrls: non-image content-type, skipping',
        );
        continue;
      }

      const buf = await res.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      // Strip any parameters from the MIME type (e.g. "image/jpeg; charset=…")
      const mime = contentType.split(';')[0]?.trim() ?? 'image/jpeg';
      results.push(`data:${mime};base64,${base64}`);
    } catch (err) {
      logger.warn({ url, err }, 'fetchImagesAsDataUrls: fetch error, skipping');
    }
  }

  return results;
}
