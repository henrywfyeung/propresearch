import { compose } from '@/agents/nodes/10_compose';
import { buildMessages } from '@/prompts/compose';
import type { RecentDA, RiskFlag } from '@/schemas/state';
import { callWithFallback } from '@/tools/llm/structuredCall';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// tests/unit/compose.test.ts
import { graphState, sampleComparable, sampleResolvedAddress } from '../fixtures/comps';

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
  bands: null,
  uncertaintyNote: null,
  narrative: 'Derived from fair-value comparables across the suburb.',
};

beforeEach(() => {
  mockLlm.mockReset();
  // Compose's schema is now an object { blocks: [...] } (OpenAI rejects array roots).
  mockLlm.mockResolvedValue({ blocks: [{ type: 'text', text: 'Section narrative prose.' }] });
});

const sampleDA: RecentDA = {
  description: 'Demolition and construction of a 4-storey residential flat building',
  status: 'Under Assessment',
  category: 'Residential',
  distanceM: 120,
  lodgedDate: '2026-03-15',
  coverage: 'full',
  sourceRef: {
    provider: 'nsw-planning',
    endpoint: 'online-da',
    fetchedAt: '2026-05-30T00:00:00.000Z',
    path: '/market/recentDAs/0/status',
  },
};

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
  it('writes all seven sections (including market, risks and planning) and stamps the valuation range first', async () => {
    const state = graphState({
      comparables: [sampleComparable('a', { selection: 'fair-value', adjustedValue: 2_500_000 })],
      triangulation: tri,
      risks: [sampleRisk],
      market: { suburbStats: null, recentNews: [], recentDAs: [sampleDA] },
    });
    const out = await compose(state);
    expect(Object.keys(out.prose ?? {}).sort()).toEqual([
      'comparables',
      'market',
      'planning',
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
    expect(mockLlm).toHaveBeenCalledTimes(7);
  });

  it('emits a deterministic "not available" planning note for non-NSW regions (no LLM for planning)', async () => {
    const state = graphState({
      resolvedAddress: { ...sampleResolvedAddress, state: 'VIC', suburb: 'Richmond' },
      comparables: [sampleComparable('a', { selection: 'fair-value', adjustedValue: 1_200_000 })],
      triangulation: tri,
      // empty DA list — for VIC this means "not queried", not "no activity"
      market: { suburbStats: null, recentNews: [], recentDAs: [] },
    });
    const out = await compose(state);
    const planning = out.prose?.planning;
    expect(planning?.[0]?.type).toBe('text');
    const text = planning?.[0]?.type === 'text' ? planning[0].text : '';
    expect(text).toContain('VIC');
    expect(text).toMatch(/not available|coverage/i);
    // must NOT infer stability from the empty list (the bad-run phrasing)
    expect(text).not.toMatch(/stable local|minimal disruption|suggests.*stable/i);
    // planning skipped the LLM → only the other 6 sections called it
    expect(mockLlm).toHaveBeenCalledTimes(6);
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
      recentDAs: [],
      suburbStats: null,
      demographics: null,
    };
    const msgs = buildMessages('risks', input);
    const userContent = msgs[1]?.content ?? '';
    expect(userContent).toContain('flood');
    expect(userContent).toContain('high');
  });

  it('planning section messages include DA description and status', () => {
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
      risks: [],
      recentDAs: [sampleDA],
      suburbStats: null,
      demographics: null,
    };
    const msgs = buildMessages('planning', input);
    const userContent = msgs[1]?.content ?? '';
    expect(userContent).toContain('4-storey residential flat building');
    expect(userContent).toContain('Under Assessment');
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
