// tests/unit/reasonAndSelect.test.ts — Node 06 as a 3-phase map-reduce.
import { reasonAndSelect } from '@/agents/nodes/06_reasonAndSelect';
import { callWithFallback } from '@/tools/llm/structuredCall';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphState, sampleComparable } from '../fixtures/comps';

vi.mock('@/tools/llm/structuredCall', () => ({ callWithFallback: vi.fn() }));
const mockLlm = vi.mocked(callWithFallback);

const plan = (compId: string, shortlist = true) => ({
  compId,
  verdict: 'comparable' as const,
  shortlist,
});
const analysis = (compId: string) => ({
  compId,
  verdict: 'comparable' as const,
  comparison: {
    size: 'similar',
    layout: 'same 3/2',
    condition: 'comparable',
    location: 'same area',
  },
  adjustments: [
    { dimension: 'land-area', delta: 0.05, rationale: 'subject parcel slightly larger' },
  ],
  adjustmentNarrative:
    'Adjusted modestly for parcel size; otherwise a close like-for-like overall.',
  adjustedValue: 2_600_000,
  recommendExclude: false,
  recommendExcludeReason: null,
});
const sel = (compId: string, selection: 'fair-value' | 'negotiation-anchor' | 'rejected') => ({
  compId,
  selection,
  rejectionReason: selection === 'rejected' ? 'too dissimilar' : null,
  selectionRationale: 'Close match on beds, baths and proximity to the subject property.',
});

const threeComps = () =>
  graphState({
    comparables: [sampleComparable('A'), sampleComparable('B'), sampleComparable('C')],
  });

// Default happy-path mock (set in beforeEach, like graph.test); individual tests
// override mockImplementation to exercise the degrade paths.
beforeEach(() => {
  mockLlm.mockReset();
  mockLlm.mockImplementation(async (opts: { node: string }) => {
    if (opts.node === 'reasonAndSelect:plan')
      return { plans: [plan('A'), plan('B'), plan('C')] } as never;
    if (opts.node === 'reasonAndSelect:analyse')
      return { analyses: [analysis('A'), analysis('B'), analysis('C')] } as never;
    if (opts.node === 'reasonAndSelect:select')
      return {
        selections: [sel('A', 'fair-value'), sel('B', 'rejected'), sel('C', 'rejected')],
      } as never;
    throw new Error(`unexpected node ${opts.node}`);
  });
});

describe('reasonAndSelect (map-reduce)', () => {
  it('merges plan verdict + analysis + selection onto the comps', async () => {
    const out = await reasonAndSelect(threeComps());
    const byId = new Map(out.comparables?.map((c) => [c.id, c]));
    expect(byId.get('A')?.selection).toBe('fair-value');
    expect(byId.get('A')?.verdict).toBe('comparable');
    expect(byId.get('A')?.adjustedValue).toBe(2_600_000);
    expect(byId.get('A')?.adjustments[0]?.deltaPct).toBe(0.05);
    expect(byId.get('A')?.adjustments[0]?.sourceRef[0]?.provider).toBe('llm');
    expect(byId.get('B')?.selection).toBe('rejected');
  });

  it('errors in-band when there are no candidates (no LLM calls)', async () => {
    mockLlm.mockReset();
    const out = await reasonAndSelect(graphState({ comparables: [] }));
    expect(out.errors?.[0]?.code).toBe('PARTIAL_DATA');
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it('falls back to a similarity shortlist when the PLAN phase fails', async () => {
    mockLlm.mockImplementation(async (opts: { node: string }) => {
      if (opts.node === 'reasonAndSelect:plan') throw new Error('plan stalled');
      if (opts.node === 'reasonAndSelect:analyse')
        return { analyses: [analysis('A'), analysis('B'), analysis('C')] } as never;
      return {
        selections: [sel('A', 'fair-value'), sel('B', 'rejected'), sel('C', 'rejected')],
      } as never;
    });
    const out = await reasonAndSelect(threeComps());
    expect(out.comparables?.find((c) => c.id === 'A')?.selection).toBe('fair-value');
  });

  it('degrades to PARTIAL_DATA when too few comps get analysed', async () => {
    mockLlm.mockImplementation(async (opts: { node: string }) => {
      if (opts.node === 'reasonAndSelect:plan')
        return { plans: [plan('A'), plan('B'), plan('C')] } as never;
      if (opts.node === 'reasonAndSelect:analyse') throw new Error('analyse batch stalled');
      return { selections: [] } as never;
    });
    const out = await reasonAndSelect(threeComps());
    expect(out.errors?.[0]?.code).toBe('PARTIAL_DATA');
  });

  it('uses a deterministic selection when the SELECT phase fails', async () => {
    mockLlm.mockImplementation(async (opts: { node: string }) => {
      if (opts.node === 'reasonAndSelect:plan')
        return { plans: [plan('A'), plan('B'), plan('C')] } as never;
      if (opts.node === 'reasonAndSelect:analyse')
        return { analyses: [analysis('A'), analysis('B'), analysis('C')] } as never;
      throw new Error('select stalled');
    });
    const out = await reasonAndSelect(threeComps());
    const fv = out.comparables?.filter((c) => c.selection === 'fair-value') ?? [];
    expect(fv.length).toBeGreaterThan(0);
  });
});
