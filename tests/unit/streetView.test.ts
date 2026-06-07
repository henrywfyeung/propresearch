// tests/unit/streetView.test.ts — Node 04c: Google Street View → structured read.

import { streetView } from '@/agents/nodes/04c_streetView';
import { callWithFallback } from '@/tools/llm/structuredCall';
import { fetchStreetViewImages } from '@/tools/streetview/fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graphState, sampleSubject } from '../fixtures/comps';

vi.mock('@/tools/llm/structuredCall', () => ({ callWithFallback: vi.fn() }));
vi.mock('@/tools/streetview/fetch', () => ({ fetchStreetViewImages: vi.fn() }));
const mockLlm = vi.mocked(callWithFallback);
const mockFetch = vi.mocked(fetchStreetViewImages);

const ASSESSMENT = {
  streetCharacter: 'leafy-residential' as const,
  busyRoad: false,
  treeCover: 'high' as const,
  neighbouringConcerns: ['powerlines overhead'],
};

const img = (heading: number) => ({ heading, bytes: Buffer.from(`img-${heading}`) });

beforeEach(() => {
  process.env.GOOGLE_MAPS_KEY = 'test-key';
  mockFetch.mockReset();
  mockLlm.mockReset();
});
afterEach(() => {
  process.env.GOOGLE_MAPS_KEY = 'test-key'; // restored per-test in beforeEach anyway
});

describe('streetView (Node 04c)', () => {
  it('fetches four headings, runs vision, and writes the assessment to subject', async () => {
    mockFetch.mockResolvedValue([img(0), img(90), img(180), img(270)]);
    mockLlm.mockResolvedValue(ASSESSMENT as never);

    const out = await streetView(graphState());

    expect(mockFetch).toHaveBeenCalledWith(-33.82, 151.24);
    expect(mockLlm).toHaveBeenCalledTimes(1);
    // images passed to vision are base64 data URLs (not the key-bearing GSV URL)
    const msgs = mockLlm.mock.calls[0]?.[0]?.messages;
    const userContent = msgs?.[1]?.content;
    const imageParts = Array.isArray(userContent)
      ? userContent.filter((p) => p.type === 'image_url')
      : [];
    expect(imageParts).toHaveLength(4);
    expect(out.subject?.streetView).toEqual(ASSESSMENT);
  });

  it('skips silently when GOOGLE_MAPS_KEY is absent (no fetch, no LLM)', async () => {
    process.env.GOOGLE_MAPS_KEY = '';
    const out = await streetView(graphState());
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockLlm).not.toHaveBeenCalled();
    expect(out.subject?.streetView).toBeNull();
  });

  it('writes null assessment when no heading has imagery (no LLM call)', async () => {
    mockFetch.mockResolvedValue([
      { heading: 0, bytes: null },
      { heading: 90, bytes: null },
      { heading: 180, bytes: null },
      { heading: 270, bytes: null },
    ]);
    const out = await streetView(graphState());
    expect(mockLlm).not.toHaveBeenCalled();
    expect(out.subject?.streetView).toBeNull();
  });

  it('degrades gracefully when vision fails — null assessment, subject preserved', async () => {
    mockFetch.mockResolvedValue([img(0)]);
    mockLlm.mockRejectedValue(new Error('vision boom'));
    const out = await streetView(graphState());
    expect(out.subject?.streetView).toBeNull();
    // the rest of the subject is carried forward intact
    expect(out.subject?.attrs).toEqual(sampleSubject.attrs);
  });

  it('preserves an existing visionAnalysis when chained after visionSubject', async () => {
    mockFetch.mockResolvedValue([img(0)]);
    mockLlm.mockResolvedValue(ASSESSMENT as never);
    const subjectWithVision = {
      ...sampleSubject,
      photos: ['https://cdn/p1.jpg'],
      visionAnalysis: {
        condition: 'good' as const,
        staging: 'vacant' as const,
        presentationFactors: [],
        redFlags: [],
        layout: {
          storeys: 'single' as const,
          structure: 'free-standing' as const,
          positionInComplex: 'not-applicable' as const,
          singleLevelLiving: null,
          streetFrontage: 'own-frontage' as const,
          era: 'contemporary' as const,
          configNotes: [],
        },
        comment: 'A neat, vacant single-level home presented in good condition.',
      },
    };
    const out = await streetView(graphState({ subject: subjectWithVision }));
    expect(out.subject?.streetView).toEqual(ASSESSMENT);
    expect(out.subject?.visionAnalysis?.condition).toBe('good');
    expect(out.subject?.photos).toEqual(['https://cdn/p1.jpg']);
  });

  it('errors in-band when there is no subject', async () => {
    const out = await streetView(graphState({ subject: null }));
    expect(out.errors?.[0]?.code).toBe('PARTIAL_DATA');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
