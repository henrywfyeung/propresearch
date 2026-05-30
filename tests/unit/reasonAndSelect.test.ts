import { reasonAndSelect } from '@/agents/nodes/06_reasonAndSelect';
import { callWithFallback } from '@/tools/llm/structuredCall';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// tests/unit/reasonAndSelect.test.ts
import { graphState, sampleComparable } from '../fixtures/comps';

vi.mock('@/tools/llm/structuredCall', () => ({ callWithFallback: vi.fn() }));
const mockLlm = vi.mocked(callWithFallback);

const decision = (compId: string, selection: 'fair-value' | 'rejected') => ({
  compId,
  selection,
  rejectionReason: selection === 'rejected' ? 'too dissimilar to the subject property' : null,
  adjustments:
    selection === 'fair-value'
      ? [
          {
            dimension: 'land-area',
            delta: 0.05,
            rationale: 'subject parcel is a little larger than this comp',
          },
        ]
      : [],
  adjustmentNarrative:
    'Adjusted modestly for parcel size; otherwise a close like-for-like comparison overall.',
  adjustedValue: 2_600_000,
  selectionRationale: 'Close match on beds, baths and proximity to the subject property.',
});

beforeEach(() => {
  mockLlm.mockReset();
});

describe('reasonAndSelect', () => {
  it('maps decisions onto the matching comps', async () => {
    mockLlm.mockResolvedValue({
      decisions: [decision('A', 'fair-value'), decision('B', 'rejected')],
    });
    const state = graphState({
      comparables: [sampleComparable('A'), sampleComparable('B'), sampleComparable('C')],
    });
    const out = await reasonAndSelect(state);
    const byId = new Map(out.comparables?.map((c) => [c.id, c]));
    expect(byId.get('A')?.selection).toBe('fair-value');
    expect(byId.get('A')?.adjustedValue).toBe(2_600_000);
    expect(byId.get('A')?.adjustments[0]?.deltaPct).toBe(0.05);
    expect(byId.get('A')?.adjustments[0]?.sourceRef[0]?.provider).toBe('llm');
    expect(byId.get('B')?.selection).toBe('rejected');
    // C had no decision -> unchanged
    expect(byId.get('C')?.selection).toBe('candidate');
  });

  it('errors in-band when there are no candidates', async () => {
    const out = await reasonAndSelect(graphState({ comparables: [] }));
    expect(out.errors?.[0]?.code).toBe('PARTIAL_DATA');
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it('propagates when the LLM is unavailable', async () => {
    mockLlm.mockRejectedValue(new Error('LLM_PROVIDERS_UNAVAILABLE'));
    await expect(
      reasonAndSelect(graphState({ comparables: [sampleComparable('A')] })),
    ).rejects.toThrow();
  });
});
