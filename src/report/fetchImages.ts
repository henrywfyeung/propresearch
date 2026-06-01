// src/report/fetchImages.ts — Server-side image download helper.
// Mirrors the pattern from src/tools/mapbox/staticMap.ts: fetch each URL
// server-side, convert bytes to a base64 data URL, skip any that fail or
// aren't image/* content, and cap the returned count. The REA CDN is public
// and keyless — a plain fetch is sufficient.
//
// Base64 data URLs are embedded directly in the PDF HTML so Puppeteer doesn't
// need to make network requests at render time (the original bug: only 2 of 6
// photos loaded before networkidle0 fired).
//
// Robustness: each URL gets a per-fetch timeout + a few retries on TRANSIENT
// failures (network error, timeout, 5xx, 429). Without this, a single dropped
// CDN connection silently reduced the embedded image count — observed live as a
// dossier rendering only 4 of 6 photos (and losing the floor plan) when one
// burst of render-time fetches hiccuped. Permanent failures (404/403, non-image
// content-type) are NOT retried — they are skipped immediately.

import { logger } from '@/lib/observability/logger';

const MAX_ATTEMPTS = 3; // total attempts per URL (1 initial + 2 retries)
const FETCH_TIMEOUT_MS = 20_000; // abort a single hung fetch after 20s
const RETRY_BACKOFF_MS = 250; // base backoff; multiplied by attempt number

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Thrown for transient conditions so the retry loop re-attempts the URL. */
class TransientImageFetchError extends Error {}

/**
 * Fetch a single URL and return it as a `data:<mime>;base64,…` string.
 * - Returns `null` for PERMANENT failures (4xx other than 429, non-image
 *   Content-Type) — the caller skips the URL without retrying.
 * - THROWS `TransientImageFetchError` for retryable conditions (network error,
 *   timeout/abort, 5xx, 429) so the caller can re-attempt.
 */
async function fetchOneAsDataUrl(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    // Network error or timeout/abort — transient, worth a retry.
    throw new TransientImageFetchError(String(err));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) {
      throw new TransientImageFetchError(`HTTP ${res.status}`);
    }
    // Permanent client error (404, 403, …) — don't retry.
    logger.warn({ url, status: res.status }, 'fetchImagesAsDataUrls: client error, skipping');
    return null;
  }

  const contentType = res.headers.get('content-type') ?? '';
  // Accept any image/* MIME type (jpeg, png, webp, gif, …).
  if (!contentType.startsWith('image/')) {
    logger.warn({ url, contentType }, 'fetchImagesAsDataUrls: non-image content-type, skipping');
    return null;
  }

  const buf = await res.arrayBuffer();
  const base64 = Buffer.from(buf).toString('base64');
  // Strip any parameters from the MIME type (e.g. "image/jpeg; charset=…")
  const mime = contentType.split(';')[0]?.trim() ?? 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

/**
 * Fetch each URL server-side and return it as a `data:<mime>;base64,…` string.
 * - Transient failures are retried (up to {@link MAX_ATTEMPTS} per URL).
 * - Permanent failures (non-2xx 4xx, non-image content) are skipped.
 * - Iterates past skipped URLs and returns at most `cap` data URLs, so callers
 *   can pass MORE candidate URLs than `cap` to absorb individual failures.
 */
export async function fetchImagesAsDataUrls(urls: string[], cap: number): Promise<string[]> {
  const results: string[] = [];
  if (cap <= 0) return results;

  for (const url of urls) {
    if (results.length >= cap) break;

    let dataUrl: string | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        dataUrl = await fetchOneAsDataUrl(url);
        break; // definitive result (data URL, or null = permanent skip)
      } catch (err) {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn(
            { url, err: String(err) },
            'fetchImagesAsDataUrls: transient fetch failed after retries, skipping',
          );
        } else {
          await delay(RETRY_BACKOFF_MS * attempt);
        }
      }
    }

    if (dataUrl) results.push(dataUrl);
  }

  return results;
}
