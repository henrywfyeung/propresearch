// tests/unit/costSink.test.ts — per-node cost aggregation + table formatting.

import { type LlmCallRecord, formatCostTable, summarizeCalls } from '@/tools/llm/costSink';
import { describe, expect, it } from 'vitest';

const rec = (node: string, costUsd: number, over: Partial<LlmCallRecord> = {}): LlmCallRecord => ({
  node,
  provider: 'openai',
  model: 'gpt-5.4',
  promptTokens: 1000,
  completionTokens: 200,
  costUsd,
  latencyMs: 1234,
  ...over,
});

describe('summarizeCalls', () => {
  it('groups by node, sums, and sorts by cost desc with a grand total', () => {
    const s = summarizeCalls([
      rec('visionComps', 0.02),
      rec('visionComps', 0.02),
      rec('reasonAndSelect', 0.9),
      rec('compose:valuation', 0.1),
    ]);
    expect(s.byNode.map((n) => n.node)).toEqual([
      'reasonAndSelect',
      'compose:valuation',
      'visionComps',
    ]);
    const vc = s.byNode.find((n) => n.node === 'visionComps');
    expect(vc?.calls).toBe(2);
    expect(vc?.costUsd).toBeCloseTo(0.04, 6);
    expect(vc?.promptTokens).toBe(2000);
    expect(s.total.calls).toBe(4);
    expect(s.total.costUsd).toBeCloseTo(1.04, 6);
  });

  it('splits cost by provider (e.g. an Anthropic fallback call)', () => {
    const s = summarizeCalls([
      rec('compose:summary', 0.1),
      rec('compose:summary', 0.3, { provider: 'anthropic', model: 'claude-sonnet-4-5' }),
    ]);
    const byP = Object.fromEntries(s.byProvider.map((p) => [p.provider, p.costUsd]));
    expect(byP.openai).toBeCloseTo(0.1, 6);
    expect(byP.anthropic).toBeCloseTo(0.3, 6);
  });

  it('handles an empty run', () => {
    const s = summarizeCalls([]);
    expect(s.byNode).toEqual([]);
    expect(s.total.costUsd).toBe(0);
    expect(s.total.calls).toBe(0);
  });
});

describe('formatCostTable', () => {
  it('renders each node, a TOTAL row, and the dollar figures', () => {
    const out = formatCostTable(
      summarizeCalls([rec('reasonAndSelect', 0.9), rec('visionComps', 0.6)]),
    );
    expect(out).toContain('reasonAndSelect');
    expect(out).toContain('visionComps');
    expect(out).toContain('TOTAL');
    expect(out).toContain('$0.9000');
    expect(out).toContain('$1.5000'); // total
    expect(out).toContain('by provider');
  });
});
