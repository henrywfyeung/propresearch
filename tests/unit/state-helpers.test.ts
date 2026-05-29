import { appendReducer, mergeByKey, resolvePointer, tryResolvePointer } from '@/agents/state';
import { PointerUnresolvedError } from '@/lib/errors';
import { describe, expect, it } from 'vitest';

describe('mergeByKey [R20]', () => {
  const merge = mergeByKey<{ id: string; x?: number; y?: number }>('id');

  it('deep-merges incoming into existing (per-field LWW), preserving untouched', () => {
    const current = [
      { id: 'a', x: 0, y: 9 },
      { id: 'b', x: 1 },
    ];
    const incoming = [{ id: 'a', x: 5 }];
    const out = merge(current, incoming);
    // a.x updated to 5, a.y preserved; b untouched.
    expect(out).toContainEqual({ id: 'a', x: 5, y: 9 });
    expect(out).toContainEqual({ id: 'b', x: 1 });
    expect(out).toHaveLength(2);
  });

  it('the crash-resumption case: a node re-emitting only new items does not wipe prior items', () => {
    // Run 1 produced 2 of 3 comps; run 2 emits only the 3rd.
    const afterRun1 = [
      { id: 'c1', x: 1 },
      { id: 'c2', x: 1 },
    ];
    const run2Output = [{ id: 'c3', x: 1 }];
    const out = merge(afterRun1, run2Output);
    expect(out.map((o) => o.id).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('does not let null/undefined incoming fields clobber existing values', () => {
    const out = merge([{ id: 'a', x: 7 }], [{ id: 'a', x: undefined }]);
    expect(out).toContainEqual({ id: 'a', x: 7 });
  });

  it('handles empty current / incoming', () => {
    expect(merge(undefined, [{ id: 'a' }])).toEqual([{ id: 'a' }]);
    expect(merge([{ id: 'a' }], undefined)).toEqual([{ id: 'a' }]);
  });
});

describe('appendReducer', () => {
  it('concatenates', () => {
    expect(appendReducer([1, 2], [3])).toEqual([1, 2, 3]);
    expect(appendReducer(undefined, [1])).toEqual([1]);
  });
});

describe('resolvePointer [R22]', () => {
  const state = {
    subject: { domainAvm: { mid: 1_250_000 } },
    comparables: [{ salePrice: 900_000 }, { salePrice: 1_100_000 }],
  };

  it('resolves nested object paths', () => {
    expect(resolvePointer(state, '/subject/domainAvm/mid')).toBe(1_250_000);
  });

  it('resolves array index paths', () => {
    expect(resolvePointer(state, '/comparables/1/salePrice')).toBe(1_100_000);
  });

  it('resolves the whole root for empty pointer', () => {
    expect(resolvePointer(state, '')).toBe(state);
  });

  it('throws PointerUnresolvedError for a missing key', () => {
    expect(() => resolvePointer(state, '/subject/missing')).toThrow(PointerUnresolvedError);
  });

  it('throws for an out-of-range array index', () => {
    expect(() => resolvePointer(state, '/comparables/9/salePrice')).toThrow(PointerUnresolvedError);
  });

  it('tryResolvePointer returns undefined instead of throwing', () => {
    expect(tryResolvePointer(state, '/nope')).toBeUndefined();
  });
});
