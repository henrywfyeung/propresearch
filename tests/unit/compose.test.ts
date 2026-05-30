import { compose } from '@/agents/nodes/10_compose';
import { callWithFallback } from '@/tools/llm/structuredCall';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// tests/unit/compose.test.ts
import { graphState, sampleComparable } from '../fixtures/comps';

vi.mock('@/tools/llm/structuredCall', () => ({ callWithFallback: vi.fn() }));
const mockLlm = vi.mocked(callWithFallback);

const tri = {
  compDerived: 2_500_000,
  low: 2_400_000,
  high: 2_600_000,
  reconciled: 2_500_000,
  confidence: 'high' as const,
  spread: 0.08,
  compIds: ['a'],
  uncertaintyNote: null,
  narrative: 'Derived from fair-value comparables across the suburb.',
};

beforeEach(() => {
  mockLlm.mockReset();
  mockLlm.mockResolvedValue([{ type: 'text', text: 'Section narrative prose.' }]);
});

describe('compose', () => {
  it('writes all four sections and stamps the valuation range first', async () => {
    const state = graphState({
      comparables: [sampleComparable('a', { selection: 'fair-value', adjustedValue: 2_500_000 })],
      triangulation: tri,
    });
    const out = await compose(state);
    expect(Object.keys(out.prose ?? {}).sort()).toEqual([
      'comparables',
      'subject',
      'summary',
      'valuation',
    ]);
    const first = out.prose?.valuation?.[0];
    expect(first?.type).toBe('range');
    if (first?.type === 'range') {
      expect(first.low).toBe(2_400_000);
      expect(first.high).toBe(2_600_000);
      expect(first.sourceRef.path).toBe('/triangulation/reconciled');
    }
    expect(mockLlm).toHaveBeenCalledTimes(4);
  });

  it('errors in-band when there is no subject', async () => {
    const out = await compose(graphState({ subject: null }));
    expect(out.errors?.[0]?.code).toBe('PARTIAL_DATA');
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it('propagates when the LLM is unavailable', async () => {
    mockLlm.mockReset();
    mockLlm.mockRejectedValue(new Error('LLM_PROVIDERS_UNAVAILABLE'));
    await expect(compose(graphState({ triangulation: tri }))).rejects.toThrow();
  });
});
