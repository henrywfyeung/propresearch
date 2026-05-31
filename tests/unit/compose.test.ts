import { compose } from '@/agents/nodes/10_compose';
import { buildMessages } from '@/prompts/compose';
import type { RiskFlag } from '@/schemas/state';
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
  // Compose's schema is now an object { blocks: [...] } (OpenAI rejects array roots).
  mockLlm.mockResolvedValue({ blocks: [{ type: 'text', text: 'Section narrative prose.' }] });
});

const sampleRisk: RiskFlag = {
  category: 'flood',
  severity: 'high',
  description: 'Property is within the 1-in-100-year flood planning area.',
  sourceRef: {
    provider: 'nsw-planning',
    endpoint: 'wfs:flood',
    fetchedAt: '2026-05-30T00:00:00.000Z',
    path: '/risks/0/severity',
  },
  evidence: 'Flood planning polygon intersects lot boundary.',
  dataAvailable: true,
};

describe('compose', () => {
  it('writes all five sections (including risks) and stamps the valuation range first', async () => {
    const state = graphState({
      comparables: [sampleComparable('a', { selection: 'fair-value', adjustedValue: 2_500_000 })],
      triangulation: tri,
      risks: [sampleRisk],
    });
    const out = await compose(state);
    expect(Object.keys(out.prose ?? {}).sort()).toEqual([
      'comparables',
      'risks',
      'subject',
      'summary',
      'valuation',
    ]);
    // Text sections carry the unwrapped blocks (guards against the array/object
    // root regression where out.blocks would be undefined).
    expect(out.prose?.summary).toEqual([{ type: 'text', text: 'Section narrative prose.' }]);
    const first = out.prose?.valuation?.[0];
    expect(first?.type).toBe('range');
    if (first?.type === 'range') {
      expect(first.low).toBe(2_400_000);
      expect(first.high).toBe(2_600_000);
      expect(first.sourceRef.path).toBe('/triangulation/reconciled');
    }
    expect(mockLlm).toHaveBeenCalledTimes(5);
  });

  it('risks section messages include the risk category and severity', () => {
    const input = {
      suburb: 'Mosman',
      subjectAttrs: {
        beds: 3,
        baths: 2,
        parking: 1,
        landArea: 500,
        buildingArea: null,
        propertyType: 'House',
      },
      triangulation: null,
      selectedComps: [],
      risks: [sampleRisk],
    };
    const msgs = buildMessages('risks', input);
    const userContent = msgs[1]?.content ?? '';
    expect(userContent).toContain('flood');
    expect(userContent).toContain('high');
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
