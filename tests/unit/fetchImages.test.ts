// tests/unit/fetchImages.test.ts
// Unit tests for fetchImagesAsDataUrls.
//
// Covers:
//   - N valid image/* URLs → N base64 data URLs
//   - A non-image/failed fetch is skipped (result omitted)
//   - cap is respected (returns at most `cap` items)
//   - non-2xx response → skipped
//   - fetch throws → skipped
//   - MIME type from Content-Type header (image/jpeg, image/png, etc.)
//   - MIME type parameters (e.g. "image/jpeg; charset=…") are stripped

import { fetchImagesAsDataUrls } from '@/report/fetchImages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchResponse(opts: {
  ok: boolean;
  status?: number;
  contentType?: string;
  body?: Uint8Array;
}) {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    headers: {
      get: (name: string) => (name === 'content-type' ? (opts.contentType ?? null) : null),
    },
    arrayBuffer: async () => (opts.body ?? new Uint8Array([1, 2, 3])).buffer,
  } as unknown as Response;
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff]); // JPEG magic
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic

function jpegResponse() {
  return makeFetchResponse({ ok: true, contentType: 'image/jpeg', body: JPEG_BYTES });
}

function pngResponse() {
  return makeFetchResponse({ ok: true, contentType: 'image/png', body: PNG_BYTES });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchImagesAsDataUrls', () => {
  it('returns a base64 data URL for each valid image URL', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jpegResponse())
      .mockResolvedValueOnce(pngResponse());

    const results = await fetchImagesAsDataUrls(
      ['https://cdn.example.com/photo1.jpg', 'https://cdn.example.com/photo2.png'],
      10,
    );

    expect(results).toHaveLength(2);
    expect(results[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(results[1]).toMatch(/^data:image\/png;base64,/);
  });

  it('encodes the correct bytes in base64', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jpegResponse());

    const results = await fetchImagesAsDataUrls(['https://cdn.example.com/a.jpg'], 1);

    const expected = `data:image/jpeg;base64,${Buffer.from(JPEG_BYTES).toString('base64')}`;
    expect(results[0]).toBe(expected);
  });

  it('skips a URL that returns a non-2xx status', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        makeFetchResponse({ ok: false, status: 404, contentType: 'image/jpeg' }),
      )
      .mockResolvedValueOnce(jpegResponse());

    const results = await fetchImagesAsDataUrls(
      ['https://cdn.example.com/missing.jpg', 'https://cdn.example.com/ok.jpg'],
      10,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('skips a URL whose Content-Type is not image/*', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        makeFetchResponse({ ok: true, contentType: 'text/html', body: new Uint8Array([1]) }),
      )
      .mockResolvedValueOnce(jpegResponse());

    const results = await fetchImagesAsDataUrls(
      ['https://example.com/not-an-image', 'https://cdn.example.com/ok.jpg'],
      10,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('skips a URL where fetch throws', async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(jpegResponse());

    const results = await fetchImagesAsDataUrls(
      ['https://cdn.example.com/bad.jpg', 'https://cdn.example.com/ok.jpg'],
      10,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('respects the cap — returns at most cap items', async () => {
    vi.mocked(global.fetch).mockResolvedValue(jpegResponse());

    const urls = ['a', 'b', 'c', 'd', 'e'].map((x) => `https://cdn.example.com/${x}.jpg`);
    const results = await fetchImagesAsDataUrls(urls, 3);

    expect(results).toHaveLength(3);
    // fetch should only have been called 3 times (cap stops early)
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(3);
  });

  it('returns an empty array for an empty URLs list', async () => {
    const results = await fetchImagesAsDataUrls([], 6);
    expect(results).toEqual([]);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it('strips MIME type parameters (e.g. "image/jpeg; charset=utf-8")', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      makeFetchResponse({
        ok: true,
        contentType: 'image/jpeg; charset=utf-8',
        body: JPEG_BYTES,
      }),
    );

    const results = await fetchImagesAsDataUrls(['https://cdn.example.com/a.jpg'], 1);

    // The data URL prefix must be clean — no semicolons or charset text
    expect(results[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(results[0]).not.toContain('charset');
  });

  it('handles cap=0 and returns an empty array immediately', async () => {
    const results = await fetchImagesAsDataUrls(['https://cdn.example.com/a.jpg'], 0);
    expect(results).toEqual([]);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });
});
