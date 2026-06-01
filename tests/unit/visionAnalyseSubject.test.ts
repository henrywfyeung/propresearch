// tests/unit/visionAnalyseSubject.test.ts
// Unit tests for Node 04a visionAnalyseSubject.
//
// Covers:
//   - no subject in state → in-band PARTIAL_DATA, no LLM call
//   - empty photos → {} (no LLM call; not an error)
//   - with photos → callWithFallback invoked with multimodal messages (image_url parts,
//     capped at 8), SubjectVisionSchema, node='visionSubject', NO reasoningEffort
//   - success → { subject: { ...state.subject, visionAnalysis } }
//   - LLM throws → {} (graceful, no error propagated)

import { visionAnalyseSubject } from '@/agents/nodes/04a_visionAnalyseSubject';
import { SubjectVisionSchema } from '@/schemas/vision';
import type { LlmMessage } from '@/tools/llm/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphState } from '../fixtures/comps';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockCallWithFallback } = vi.hoisted(() => ({
  mockCallWithFallback: vi.fn(),
}));

vi.mock('@/tools/llm/structuredCall', () => ({
  callWithFallback: mockCallWithFallback,
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

const PHOTOS = [
  'https://example.com/photo1.jpg',
  'https://example.com/photo2.jpg',
  'https://example.com/photo3.jpg',
];

// More than 8 photos to test the cap
const MANY_PHOTOS = Array.from({ length: 12 }, (_, i) => `https://example.com/photo${i}.jpg`);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockCallWithFallback.mockReset();
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
  });
});

// ---------------------------------------------------------------------------
// Empty photos → {} (no LLM call)
// ---------------------------------------------------------------------------

describe('visionAnalyseSubject — empty photos', () => {
  it('returns {} without calling the LLM when photos array is empty', async () => {
    const result = await visionAnalyseSubject(
      graphState({ subject: { ...graphState().subject!, photos: [] } }),
    );
    expect(result).toEqual({});
    expect(mockCallWithFallback).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// With photos → calls LLM with correct multimodal messages
// ---------------------------------------------------------------------------

describe('visionAnalyseSubject — with photos', () => {
  it('calls callWithFallback with multimodal messages, SubjectVisionSchema, and no reasoningEffort', async () => {
    mockCallWithFallback.mockResolvedValue(validVision);

    await visionAnalyseSubject(
      graphState({ subject: { ...graphState().subject!, photos: PHOTOS } }),
    );

    expect(mockCallWithFallback).toHaveBeenCalledOnce();
    const callOpts = mockCallWithFallback.mock.calls[0]?.[0];
    expect(callOpts).toBeDefined();

    // model + schema + node
    expect(callOpts.model).toBe('gpt-5.4-vision-test');
    expect(callOpts.schema).toBe(SubjectVisionSchema);
    expect(callOpts.node).toBe('visionSubject');

    // no reasoningEffort on vision calls
    expect(callOpts.reasoningEffort).toBeUndefined();

    // Messages: system (string) + user (array with text + image_url parts)
    const msgs: LlmMessage[] = callOpts.messages;
    expect(msgs).toHaveLength(2);

    const [systemMsg, userMsg] = msgs;
    expect(systemMsg?.role).toBe('system');
    expect(typeof systemMsg?.content).toBe('string');

    expect(userMsg?.role).toBe('user');
    expect(Array.isArray(userMsg?.content)).toBe(true);
    const userContent = userMsg?.content as Array<{ type: string; image_url?: { url: string } }>;

    // First part is text
    expect(userContent[0]?.type).toBe('text');

    // Remaining parts are image_url parts, one per photo
    const imageParts = userContent.filter((p) => p.type === 'image_url');
    expect(imageParts).toHaveLength(PHOTOS.length);
    expect(imageParts[0]?.image_url?.url).toBe(PHOTOS[0]);
    expect(imageParts[1]?.image_url?.url).toBe(PHOTOS[1]);
    expect(imageParts[2]?.image_url?.url).toBe(PHOTOS[2]);
  });

  it('caps image parts at 8 even when more photos are provided', async () => {
    mockCallWithFallback.mockResolvedValue(validVision);

    await visionAnalyseSubject(
      graphState({ subject: { ...graphState().subject!, photos: MANY_PHOTOS } }),
    );

    const callOpts = mockCallWithFallback.mock.calls[0]?.[0];
    const userContent = callOpts.messages[1].content as Array<{ type: string }>;
    const imageParts = userContent.filter((p: { type: string }) => p.type === 'image_url');
    expect(imageParts).toHaveLength(8);
  });

  it('returns { subject: { ...state.subject, visionAnalysis } } on success', async () => {
    mockCallWithFallback.mockResolvedValue(validVision);
    const baseSubject = { ...graphState().subject!, photos: PHOTOS };
    const state = graphState({ subject: baseSubject });

    const result = await visionAnalyseSubject(state);

    expect(result.subject).toBeDefined();
    expect(result.subject?.visionAnalysis).toEqual(validVision);
    // Other subject fields preserved
    expect(result.subject?.attrs).toEqual(baseSubject.attrs);
    expect(result.subject?.photos).toEqual(PHOTOS);
    expect(result.subject?.listing).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LLM throws → {} (graceful, non-fatal)
// ---------------------------------------------------------------------------

describe('visionAnalyseSubject — LLM failure is graceful', () => {
  it('returns {} without propagating when callWithFallback throws', async () => {
    mockCallWithFallback.mockRejectedValue(new Error('LLM both-providers-down'));

    const result = await visionAnalyseSubject(
      graphState({ subject: { ...graphState().subject!, photos: PHOTOS } }),
    );

    expect(result).toEqual({});
    // No errors field propagated
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
    mockCallWithFallback.mockResolvedValue(validVision);

    await visionAnalyseSubject(
      graphState({ subject: { ...graphState().subject!, photos: PHOTOS } }),
    );

    const callOpts = mockCallWithFallback.mock.calls[0]?.[0];
    expect(callOpts.model).toBe('gpt-5-reasoning-fallback');
  });

  it('passes empty string when neither model env var is set', async () => {
    process.env.OPENAI_MODEL_VISION = '';
    process.env.OPENAI_MODEL_REASONING = '';
    mockCallWithFallback.mockResolvedValue(validVision);

    await visionAnalyseSubject(
      graphState({ subject: { ...graphState().subject!, photos: PHOTOS } }),
    );

    const callOpts = mockCallWithFallback.mock.calls[0]?.[0];
    expect(callOpts.model).toBe('');
  });
});
