// tests/unit/visionAnalyseSubject.test.ts
// Unit tests for Node 04a visionAnalyseSubject.
//
// Covers:
//   - no subject in state → in-band PARTIAL_DATA, no LLM call
//   - media returns photos+floorplans → merged into subject.photos (listing + floorplan + user extras, deduped),
//     vision called over merged set (cap 8), result has visionAnalysis.
//   - media null (not listed) + user-supplied subject.photos → uses just user extras (vision runs on them).
//   - media null + no user photos → {subject:{...,photos:[],visionAnalysis:null}}, no vision call.
//   - vision throws → photos still written, visionAnalysis null (graceful).
//   - Address: fetchListingMedia called with rawAddress (or resolvedAddress fallback).
//   - LLM message shape, schema, node='visionSubject', NO reasoningEffort.
//   - Photo cap at 8.

import { visionAnalyseSubject } from '@/agents/nodes/04a_visionAnalyseSubject';
import { SubjectVisionSchema } from '@/schemas/vision';
import type { LlmMessage } from '@/tools/llm/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphState } from '../fixtures/comps';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockCallWithFallback, mockFetchListingMedia } = vi.hoisted(() => ({
  mockCallWithFallback: vi.fn(),
  mockFetchListingMedia: vi.fn(),
}));

vi.mock('@/tools/llm/structuredCall', () => ({
  callWithFallback: mockCallWithFallback,
}));

vi.mock('@/tools/rapidapi/listingMedia', () => ({
  fetchListingMedia: mockFetchListingMedia,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_VISION = {
  condition: 'good' as const,
  staging: 'lived-in-tidy' as const,
  presentationFactors: ['freshly painted interiors', 'timber floors'],
  redFlags: [],
  comment:
    'Property presents well overall. Interiors are clean and well-maintained with no obvious defects visible in the provided photos.',
};

// Parse through the schema so the type is correct
const validVision = SubjectVisionSchema.parse(SAMPLE_VISION);

const LISTING_PHOTOS = ['https://rea-cdn.com/photo1.jpg', 'https://rea-cdn.com/photo2.jpg'];
const FLOORPLAN_PHOTOS = ['https://rea-cdn.com/floorplan1.jpg'];
const USER_PHOTOS = ['https://example.com/user1.jpg', 'https://example.com/user2.jpg'];

// More than 8 photos total (to test the cap)
const MANY_LISTING_PHOTOS = Array.from(
  { length: 10 },
  (_, i) => `https://rea-cdn.com/photo${i}.jpg`,
);

const mediaResult = {
  listingUrl: 'https://www.realestate.com.au/property-house-123',
  photos: LISTING_PHOTOS,
  floorplans: FLOORPLAN_PHOTOS,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockCallWithFallback.mockReset();
  mockFetchListingMedia.mockReset();
  process.env.OPENAI_MODEL_VISION = 'gpt-5.4-vision-test';
});

// ---------------------------------------------------------------------------
// No subject → PARTIAL_DATA
// ---------------------------------------------------------------------------

describe('visionAnalyseSubject — no subject', () => {
  it('returns PARTIAL_DATA error when subject is null', async () => {
    const result = await visionAnalyseSubject(graphState({ subject: null }));
    expect(result.errors).toEqual([
      { code: 'PARTIAL_DATA', message: 'visionAnalyseSubject: no subject in state' },
    ]);
    expect(mockCallWithFallback).not.toHaveBeenCalled();
    expect(mockFetchListingMedia).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Address resolution: rawAddress preferred, resolvedAddress fallback
// ---------------------------------------------------------------------------

describe('visionAnalyseSubject — address for fetchListingMedia', () => {
  it('calls fetchListingMedia with rawAddress when present', async () => {
    mockFetchListingMedia.mockResolvedValue(null);
    const state = graphState({
      rawAddress: '1 Awaba St, Mosman NSW 2088',
      subject: { ...graphState().subject!, photos: [] },
    });
    await visionAnalyseSubject(state);
    expect(mockFetchListingMedia).toHaveBeenCalledWith('1 Awaba St, Mosman NSW 2088');
  });

  it('falls back to resolvedAddress.normalizedAddress when rawAddress is empty', async () => {
    mockFetchListingMedia.mockResolvedValue(null);
    const state = graphState({
      rawAddress: '',
      subject: { ...graphState().subject!, photos: [] },
    });
    // sampleResolvedAddress.normalizedAddress = '1 Example St, Mosman NSW 2088'
    await visionAnalyseSubject(state);
    expect(mockFetchListingMedia).toHaveBeenCalledWith('1 Example St, Mosman NSW 2088');
  });

  it('does not call fetchListingMedia when both address sources are absent', async () => {
    mockFetchListingMedia.mockResolvedValue(null);
    const state = graphState({
      rawAddress: '',
      resolvedAddress: null,
      subject: { ...graphState().subject!, photos: [] },
    });
    await visionAnalyseSubject(state);
    expect(mockFetchListingMedia).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Media returns photos + floorplans → merged, deduped, vision runs
// ---------------------------------------------------------------------------

describe('visionAnalyseSubject — media fetch succeeds', () => {
  it('merges listing photos + floorplans + user extras into subject.photos (listing first)', async () => {
    mockFetchListingMedia.mockResolvedValue(mediaResult);
    mockCallWithFallback.mockResolvedValue(validVision);

    const state = graphState({
      rawAddress: '1 Awaba St, Mosman NSW 2088',
      subject: { ...graphState().subject!, photos: USER_PHOTOS },
    });
    const result = await visionAnalyseSubject(state);

    const expected = [...LISTING_PHOTOS, ...FLOORPLAN_PHOTOS, ...USER_PHOTOS];
    expect(result.subject?.photos).toEqual(expected);
  });

  it('deduplicates URLs across listing and user sources', async () => {
    const sharedUrl = 'https://rea-cdn.com/photo1.jpg';
    mockFetchListingMedia.mockResolvedValue({
      ...mediaResult,
      photos: [sharedUrl, 'https://rea-cdn.com/photo2.jpg'],
      floorplans: [],
    });
    mockCallWithFallback.mockResolvedValue(validVision);

    const state = graphState({
      rawAddress: '1 Awaba St',
      // sharedUrl also present in user extras — should only appear once
      subject: { ...graphState().subject!, photos: [sharedUrl, 'https://example.com/extra.jpg'] },
    });
    const result = await visionAnalyseSubject(state);

    const photos = result.subject?.photos ?? [];
    const unique = new Set(photos);
    expect(unique.size).toBe(photos.length); // no duplicates
    expect(photos).toContain(sharedUrl);
    expect(photos).toContain('https://rea-cdn.com/photo2.jpg');
    expect(photos).toContain('https://example.com/extra.jpg');
  });

  it('calls callWithFallback with the merged photo set (capped at 8), SubjectVisionSchema, node=visionSubject, no reasoningEffort', async () => {
    mockFetchListingMedia.mockResolvedValue({
      listingUrl: null,
      photos: MANY_LISTING_PHOTOS,
      floorplans: [],
    });
    mockCallWithFallback.mockResolvedValue(validVision);

    const state = graphState({
      rawAddress: '1 Awaba St',
      subject: { ...graphState().subject!, photos: [] },
    });
    await visionAnalyseSubject(state);

    expect(mockCallWithFallback).toHaveBeenCalledOnce();
    const callOpts = mockCallWithFallback.mock.calls[0]?.[0];

    expect(callOpts.model).toBe('gpt-5.4-vision-test');
    expect(callOpts.schema).toBe(SubjectVisionSchema);
    expect(callOpts.node).toBe('visionSubject');
    expect(callOpts.reasoningEffort).toBeUndefined();

    const msgs: LlmMessage[] = callOpts.messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[1]?.role).toBe('user');

    const userContent = msgs[1]?.content as Array<{ type: string }>;
    const imageParts = userContent.filter((p) => p.type === 'image_url');
    expect(imageParts).toHaveLength(8); // capped
  });

  it('returns visionAnalysis on success', async () => {
    mockFetchListingMedia.mockResolvedValue(mediaResult);
    mockCallWithFallback.mockResolvedValue(validVision);

    const result = await visionAnalyseSubject(
      graphState({
        rawAddress: '1 Awaba St',
        subject: { ...graphState().subject!, photos: [] },
      }),
    );

    expect(result.subject?.visionAnalysis).toEqual(validVision);
  });
});

// ---------------------------------------------------------------------------
// Media null (not listed) + user-supplied photos → uses just user extras
// ---------------------------------------------------------------------------

describe('visionAnalyseSubject — media null, user extras present', () => {
  it('runs vision on user-supplied photos when media is null', async () => {
    mockFetchListingMedia.mockResolvedValue(null);
    mockCallWithFallback.mockResolvedValue(validVision);

    const state = graphState({
      rawAddress: '1 Awaba St',
      subject: { ...graphState().subject!, photos: USER_PHOTOS },
    });
    const result = await visionAnalyseSubject(state);

    expect(result.subject?.photos).toEqual(USER_PHOTOS);
    expect(result.subject?.visionAnalysis).toEqual(validVision);
    expect(mockCallWithFallback).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Media null + no user photos → early return, no vision call
// ---------------------------------------------------------------------------

describe('visionAnalyseSubject — no photos at all', () => {
  it('returns {subject:{...,photos:[],visionAnalysis:null}} and does not call vision', async () => {
    mockFetchListingMedia.mockResolvedValue(null);

    const baseSubject = { ...graphState().subject!, photos: [] };
    const result = await visionAnalyseSubject(
      graphState({ rawAddress: '1 Awaba St', subject: baseSubject }),
    );

    expect(result.subject?.photos).toEqual([]);
    expect(result.subject?.visionAnalysis).toBeNull();
    // Preserve other subject fields
    expect(result.subject?.attrs).toEqual(baseSubject.attrs);
    expect(mockCallWithFallback).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Vision throws → photos still written, visionAnalysis null (graceful)
// ---------------------------------------------------------------------------

describe('visionAnalyseSubject — LLM failure is graceful', () => {
  it('writes photos to state even when callWithFallback throws', async () => {
    mockFetchListingMedia.mockResolvedValue(mediaResult);
    mockCallWithFallback.mockRejectedValue(new Error('LLM both-providers-down'));

    const result = await visionAnalyseSubject(
      graphState({
        rawAddress: '1 Awaba St',
        subject: { ...graphState().subject!, photos: USER_PHOTOS },
      }),
    );

    // Photos are written
    const expected = [...LISTING_PHOTOS, ...FLOORPLAN_PHOTOS, ...USER_PHOTOS];
    expect(result.subject?.photos).toEqual(expected);
    // visionAnalysis is null, not an error
    expect(result.subject?.visionAnalysis).toBeNull();
    expect(result.errors).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fetchListingMedia throws → treated as null, user photos used, no propagation
// ---------------------------------------------------------------------------

describe('visionAnalyseSubject — fetchListingMedia throws', () => {
  it('falls back to user photos when fetchListingMedia itself throws', async () => {
    mockFetchListingMedia.mockRejectedValue(new Error('network failure'));
    mockCallWithFallback.mockResolvedValue(validVision);

    const state = graphState({
      rawAddress: '1 Awaba St',
      subject: { ...graphState().subject!, photos: USER_PHOTOS },
    });
    const result = await visionAnalyseSubject(state);

    expect(result.subject?.photos).toEqual(USER_PHOTOS);
    expect(result.subject?.visionAnalysis).toEqual(validVision);
    expect(result.errors).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OPENAI_MODEL_VISION env var fallback
// ---------------------------------------------------------------------------

describe('visionAnalyseSubject — model env var resolution', () => {
  it('falls back to OPENAI_MODEL_REASONING when OPENAI_MODEL_VISION is unset', async () => {
    process.env.OPENAI_MODEL_VISION = '';
    process.env.OPENAI_MODEL_REASONING = 'gpt-5-reasoning-fallback';
    mockFetchListingMedia.mockResolvedValue(null);
    mockCallWithFallback.mockResolvedValue(validVision);

    await visionAnalyseSubject(
      graphState({ subject: { ...graphState().subject!, photos: USER_PHOTOS } }),
    );

    const callOpts = mockCallWithFallback.mock.calls[0]?.[0];
    expect(callOpts.model).toBe('gpt-5-reasoning-fallback');
  });

  it('passes empty string when neither model env var is set', async () => {
    process.env.OPENAI_MODEL_VISION = '';
    process.env.OPENAI_MODEL_REASONING = '';
    mockFetchListingMedia.mockResolvedValue(null);
    mockCallWithFallback.mockResolvedValue(validVision);

    await visionAnalyseSubject(
      graphState({ subject: { ...graphState().subject!, photos: USER_PHOTOS } }),
    );

    const callOpts = mockCallWithFallback.mock.calls[0]?.[0];
    expect(callOpts.model).toBe('');
  });
});
