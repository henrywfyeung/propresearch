import { toReportData } from '@/report/toReportData';
import { describe, expect, it } from 'vitest';
// tests/unit/toReportData.test.ts
import { graphState, sampleComparable } from '../fixtures/comps';

const tri = {
  compDerived: 2_500_000,
  low: 2_400_000,
  high: 2_600_000,
  reconciled: 2_500_000,
  confidence: 'high' as const,
  spread: 0.08,
  compIds: ['a'],
  uncertaintyNote: null,
  narrative: 'Derived from fair-value comparables across the suburb here.',
};

describe('toReportData', () => {
  it('maps a full graph state into ReportData', () => {
    const state = graphState({
      triangulation: tri,
      comparables: [sampleComparable('a', { selection: 'fair-value' })],
      prose: { summary: [{ type: 'text', text: 'hi' }] },
    });
    const data = toReportData(state);
    expect(data).not.toBeNull();
    expect(data?.suburb).toBe('Mosman');
    expect(data?.subject.beds).toBe(3);
    expect(data?.triangulation?.reconciled).toBe(2_500_000);
    expect(data?.comparables).toHaveLength(1);
    expect(data?.prose.summary?.[0]?.type).toBe('text');
  });

  it('initialises photos and floorplans as empty arrays (render node overrides with base64)', () => {
    const state = graphState({
      subject: {
        ...graphState().subject!,
        photos: ['https://cdn.example.com/photo1.jpg'],
        floorplans: ['https://cdn.example.com/fp1.jpg'],
      },
    });
    const data = toReportData(state);
    // toReportData is sync — it cannot fetch, so it always returns []
    // The render node replaces them with downloaded base64 data URLs.
    expect(data?.photos).toEqual([]);
    expect(data?.floorplans).toEqual([]);
  });

  it('returns null when subject or address is missing', () => {
    expect(toReportData(graphState({ subject: null }))).toBeNull();
    expect(toReportData(graphState({ resolvedAddress: null }))).toBeNull();
  });
});
