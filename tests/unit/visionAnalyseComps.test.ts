// tests/unit/visionAnalyseComps.test.ts — Node 04b: per-comp vision fan-out.

import { visionAnalyseComps } from '@/agents/nodes/04b_visionAnalyseComps';
import { callWithFallback } from '@/tools/llm/structuredCall';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphState, sampleComparable } from '../fixtures/comps';

vi.mock('@/tools/llm/structuredCall', () => ({ callWithFallback: vi.fn() }));
const mockLlm = vi.mocked(callWithFallback);

const SAMPLE_VISION = {
  condition: 'good' as const,
  presentationFactors: ['neat presentation'],
  redFlags: [],
  layout: {
    storeys: 'single' as const,
    structure: 'free-standing' as const,
    era: 'contemporary' as const,
  },
};

afterEach(() => mockLlm.mockReset());

const withPhotos = (id: string) =>
  sampleComparable(id, { photos: [`https://cdn/${id}-1.jpg`, `https://cdn/${id}-2.jpg`] });

describe('visionAnalyseComps', () => {
  it('attaches vision to every comp that has photos', async () => {
    mockLlm.mockResolvedValue(SAMPLE_VISION as never);
    const state = graphState({ comparables: [withPhotos('a'), withPhotos('b')] });
    const out = await visionAnalyseComps(state);
    expect(out.comparables?.every((c) => c.visionAnalysis?.condition === 'good')).toBe(true);
    expect(out.comparables?.[0]?.visionAnalysis?.layout?.structure).toBe('free-standing');
    expect(mockLlm).toHaveBeenCalledTimes(2);
  });

  it('only visions the top-K comps by similarity (cost control)', async () => {
    process.env.VISION_COMPS_TOPK = '2';
    mockLlm.mockResolvedValue(SAMPLE_VISION as never);
    const state = graphState({
      comparables: [
        sampleComparable('hi1', { photos: ['https://cdn/1.jpg'], similarityScore: 90 }),
        sampleComparable('hi2', { photos: ['https://cdn/2.jpg'], similarityScore: 85 }),
        sampleComparable('lo', { photos: ['https://cdn/3.jpg'], similarityScore: 10 }),
      ],
    });
    const out = await visionAnalyseComps(state);
    expect(mockLlm).toHaveBeenCalledTimes(2); // only the top-2 by similarity
    expect(out.comparables?.find((c) => c.id === 'lo')?.visionAnalysis).toBeNull();
    expect(out.comparables?.find((c) => c.id === 'hi1')?.visionAnalysis?.condition).toBe('good');
    delete process.env.VISION_COMPS_TOPK;
  });

  it('skips comps with no photos without calling the LLM', async () => {
    mockLlm.mockResolvedValue(SAMPLE_VISION as never);
    const state = graphState({ comparables: [sampleComparable('a', { photos: [] })] });
    const out = await visionAnalyseComps(state);
    expect(out.comparables?.[0]?.visionAnalysis).toBeNull();
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it('is idempotent — already-analysed comps are not re-charged', async () => {
    mockLlm.mockResolvedValue(SAMPLE_VISION as never);
    const done = sampleComparable('a', {
      photos: ['https://cdn/a.jpg'],
      visionAnalysis: SAMPLE_VISION,
    });
    const out = await visionAnalyseComps(graphState({ comparables: [done, withPhotos('b')] }));
    expect(mockLlm).toHaveBeenCalledTimes(1); // only 'b'
    expect(out.comparables?.find((c) => c.id === 'a')?.visionAnalysis).toEqual(SAMPLE_VISION);
  });

  it('degrades gracefully — a per-comp failure leaves that comp null, others succeed', async () => {
    mockLlm
      .mockRejectedValueOnce(new Error('vision boom'))
      .mockResolvedValueOnce(SAMPLE_VISION as never);
    const out = await visionAnalyseComps(
      graphState({ comparables: [withPhotos('a'), withPhotos('b')] }),
    );
    const a = out.comparables?.find((c) => c.id === 'a');
    const b = out.comparables?.find((c) => c.id === 'b');
    expect(a?.visionAnalysis).toBeNull();
    expect(b?.visionAnalysis?.condition).toBe('good');
  });

  it('returns an empty patch when there are no comps', async () => {
    const out = await visionAnalyseComps(graphState({ comparables: [] }));
    expect(out).toEqual({});
    expect(mockLlm).not.toHaveBeenCalled();
  });
});
