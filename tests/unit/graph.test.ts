// tests/unit/graph.test.ts
import { runGraph } from '@/agents/graph';
import { callWithFallback } from '@/tools/llm/structuredCall';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REA_HOST,
  listing,
  mockMapbox,
  mockReaBlocked,
  mockReaOk,
  sampleRawAddress,
  sampleSubject,
} from '../fixtures/comps';

vi.mock('@/tools/llm/structuredCall', () => ({ callWithFallback: vi.fn() }));
const mockLlm = vi.mocked(callWithFallback);

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());
beforeEach(() => {
  process.env.RAPIDAPI_KEY = 'test-key';
  process.env.RAPIDAPI_REA_HOST = REA_HOST;
  process.env.MAPBOX_TOKEN = 'test-token';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-30T00:00:00Z'));
  mockLlm.mockReset();
  mockLlm.mockResolvedValue({
    decisions: [
      {
        compId: 'NEAR',
        selection: 'fair-value',
        rejectionReason: null,
        adjustments: [
          {
            dimension: 'land-area',
            delta: 0.05,
            rationale: 'subject parcel is slightly larger than this comp',
          },
        ],
        adjustmentNarrative:
          'Adjusted modestly; otherwise a close like-for-like comparison overall here.',
        adjustedValue: 2_600_000,
        selectionRationale: 'Close match on beds, baths and proximity to the subject.',
      },
      {
        compId: 'FAR',
        selection: 'rejected',
        rejectionReason: 'too far and bedroom count differs',
        adjustments: [],
        adjustmentNarrative:
          'Rejected: distance and bedroom mismatch make this an unreliable comparison here.',
        adjustedValue: 4_000_000,
        selectionRationale: 'Excluded from the fair-value set due to distance and size mismatch.',
      },
    ],
  });
});

const input = { reportId: 'r1', rawAddress: sampleRawAddress, subject: sampleSubject };

describe('reportGraph', () => {
  it('resolves the address then lands ranked comparables', async () => {
    mockMapbox(server);
    mockReaOk(server, [
      listing('FAR', { beds: 5, lat: -33.86, lng: 151.2 }),
      listing('NEAR', { beds: 3, lat: -33.8201, lng: 151.2401 }),
    ]);
    const state = await runGraph(input);
    expect(state.resolvedAddress?.suburb).toBe('Mosman');
    expect(state.comparables.map((c) => c.id)).toEqual(['NEAR', 'FAR']);
    expect(state.comparables.find((c) => c.id === 'NEAR')?.selection).toBe('fair-value');
    expect(state.triangulation?.reconciled).toBeGreaterThan(0);
    expect(state.errors).toEqual([]);
  });

  it('completes with an empty pool + PARTIAL_DATA when REA is blocked', async () => {
    mockMapbox(server);
    mockReaBlocked(server);
    const state = await runGraph(input);
    expect(state.resolvedAddress?.suburb).toBe('Mosman');
    expect(state.comparables).toEqual([]);
    expect(state.errors[0]?.code).toBe('PARTIAL_DATA');
  });
});
