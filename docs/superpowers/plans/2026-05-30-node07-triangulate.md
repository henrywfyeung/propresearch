# Node 07 triangulate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the deterministic `triangulate` node that reconciles the fair-value comps into a comp-derived value range, replacing the Domain-shaped `TriangulatedValueSchema`.

**Architecture:** Three tasks — (1) rewrite the schema (v2 comp-only) + its test, (2) the deterministic node + `triangulation` channel + node test, (3) graph wiring + graph-test update. No LLM.

**Tech Stack:** Zod 3.25, `@langchain/langgraph@0.2.34`, Vitest 2.1, Biome. `@/` → `src/`. Repo uses `noUncheckedIndexedAccess`.

**Reference spec:** `docs/superpowers/specs/2026-05-30-node07-triangulate-design.md`

**Verified:** `TriangulatedValueSchema`/`TriangulatedValue` live in `src/schemas/state.ts` and are referenced only by `tests/unit/triangulation.test.ts` (no node consumes them yet). `Comparable` has `adjustedValue: number|null`, `salePrice: number`, `similarityScore: number`, `selection` enum.

---

## File map

| File | Action |
|---|---|
| `src/schemas/state.ts` | Modify (`TriangulatedValueSchema` → v2 shape) |
| `tests/unit/triangulation.test.ts` | Modify (rewrite for the new shape) |
| `src/agents/nodes/07_triangulate.ts` | Create |
| `src/agents/annotation.ts` | Modify (+`triangulation` channel) |
| `src/agents/graph.ts` | Modify (wire the node) |
| `tests/unit/triangulate.test.ts` | Create |
| `tests/unit/graph.test.ts` | Modify (assert `triangulation` set) |

---

## Task 1: Rewrite `TriangulatedValueSchema` (v2)

**Files:** Modify `src/schemas/state.ts`; Modify `tests/unit/triangulation.test.ts`

- [ ] **Step 1: Rewrite the schema test** (replace the whole file)

```ts
// tests/unit/triangulation.test.ts
import { TriangulatedValueSchema } from '@/schemas/state';
import { describe, expect, it } from 'vitest';

const base = {
  compDerived: 2_500_000,
  low: 2_300_000,
  high: 2_700_000,
  reconciled: 2_500_000,
  confidence: 'high' as const,
  spread: 0.16,
  compIds: ['a', 'b', 'c'],
  uncertaintyNote: null,
  narrative: 'Derived from 3 fair-value comparables; weighted estimate around 2.5M with a tight range.',
};

describe('TriangulatedValueSchema (v2 comp-derived)', () => {
  it('accepts a valid comp-derived value', () => {
    expect(TriangulatedValueSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a high spread (>0.25) with confidence high and no note [R44]', () => {
    expect(TriangulatedValueSchema.safeParse({ ...base, spread: 0.5 }).success).toBe(false);
  });

  it('accepts a high spread when confidence=low and an uncertaintyNote is present [R44]', () => {
    const good = {
      ...base,
      spread: 0.5,
      confidence: 'low' as const,
      uncertaintyNote: 'The comparables span a wide range; treat the estimate as indicative.',
    };
    expect(TriangulatedValueSchema.safeParse(good).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `pnpm vitest run tests/unit/triangulation.test.ts`
Expected: FAIL — the old schema still requires `domainAvm`/`weights`, so `base` (which omits them) is rejected; type error on the removed fields.

- [ ] **Step 3: Rewrite `TriangulatedValueSchema` in `src/schemas/state.ts`**

Replace the entire `export const TriangulatedValueSchema = …;` block (keep the `export type TriangulatedValue = z.infer<typeof TriangulatedValueSchema>;` line right after) with:

```ts
export const TriangulatedValueSchema = z
  .object({
    compDerived: z.number(), // similarity-weighted mean of fair-value comps' adjustedValue
    low: z.number(),
    high: z.number(),
    reconciled: z.number(), // = compDerived in v2 (single signal)
    confidence: z.enum(['high', 'medium', 'low']),
    spread: z.number().min(0), // (high - low) / median
    compIds: z.array(z.string()),
    uncertaintyNote: z.string().nullable(), // required when spread > 0.25
    narrative: z.string().min(40),
  })
  .refine(
    (v) => v.spread <= 0.25 || (v.confidence === 'low' && v.uncertaintyNote !== null),
    'high spread (>0.25) requires confidence=low and an uncertaintyNote',
  );
```

- [ ] **Step 4: Run → pass + gate**

```bash
pnpm exec biome check --write src/schemas/state.ts tests/unit/triangulation.test.ts
pnpm vitest run tests/unit/triangulation.test.ts
pnpm typecheck && pnpm lint && pnpm test
```
Expected: all PASS (no other file referenced the removed fields).

- [ ] **Step 5: Commit**

```bash
git add src/schemas/state.ts tests/unit/triangulation.test.ts
git commit -m "refactor: TriangulatedValueSchema -> v2 comp-derived (drop AVM/rental/weights)"
```

---

## Task 2: The `triangulate` node + channel

**Files:** Create `src/agents/nodes/07_triangulate.ts`; Modify `src/agents/annotation.ts` (+channel); Test `tests/unit/triangulate.test.ts`

- [ ] **Step 1: Write the node test**

```ts
// tests/unit/triangulate.test.ts
import { graphState, sampleComparable } from '../fixtures/comps';
import { triangulate } from '@/agents/nodes/07_triangulate';
import { TriangulatedValueSchema } from '@/schemas/state';
import { describe, expect, it } from 'vitest';

const fv = (id: string, adjustedValue: number, similarityScore = 80) =>
  sampleComparable(id, { selection: 'fair-value', adjustedValue, similarityScore });

describe('triangulate', () => {
  it('produces a schema-valid comp-derived value from the fair-value comps', () => {
    const state = graphState({
      comparables: [fv('a', 2_400_000), fv('b', 2_500_000), fv('c', 2_600_000), sampleComparable('z', { selection: 'rejected' })],
    });
    const out = triangulate(state);
    expect(out.triangulation).toBeDefined();
    expect(() => TriangulatedValueSchema.parse(out.triangulation)).not.toThrow();
    expect(out.triangulation?.compIds).toEqual(['a', 'b', 'c']);
    expect(out.triangulation?.low).toBe(2_400_000);
    expect(out.triangulation?.high).toBe(2_600_000);
    expect(out.triangulation?.reconciled).toBe(out.triangulation?.compDerived);
    expect(out.triangulation?.confidence).toBe('high'); // tight cluster, >=3 comps
  });

  it('weights toward the higher-similarity comp', () => {
    const state = graphState({ comparables: [fv('a', 2_000_000, 100), fv('b', 3_000_000, 10)] });
    const out = triangulate(state);
    // plain mean = 2.5M; weighted toward 'a' (sim 100) -> below 2.5M
    expect(out.triangulation?.compDerived).toBeLessThan(2_500_000);
  });

  it('wide spread -> low confidence + uncertaintyNote', () => {
    const state = graphState({ comparables: [fv('a', 2_000_000), fv('b', 3_200_000)] });
    const out = triangulate(state);
    expect(out.triangulation?.confidence).toBe('low');
    expect(out.triangulation?.uncertaintyNote).not.toBeNull();
    expect(() => TriangulatedValueSchema.parse(out.triangulation)).not.toThrow();
  });

  it('errors in-band when there are no fair-value comps', () => {
    const out = triangulate(graphState({ comparables: [sampleComparable('z', { selection: 'rejected' })] }));
    expect(out.errors?.[0]?.code).toBe('PARTIAL_DATA');
    expect(out.triangulation).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `pnpm vitest run tests/unit/triangulate.test.ts`
Expected: FAIL — `Cannot find module '@/agents/nodes/07_triangulate'`.

- [ ] **Step 3a: Create `src/agents/nodes/07_triangulate.ts`**

```ts
// src/agents/nodes/07_triangulate.ts — Node 07 (CLAUDE.md §7.9, v2 comp-only).
// Deterministic: reconciles the fair-value comps into a similarity-weighted value
// range. No LLM; the prose is Node 10 (compose).

import type { GraphState } from '@/agents/annotation';

export function triangulate(state: GraphState): Partial<GraphState> {
  const selected = state.comparables.filter((c) => c.selection === 'fair-value');
  if (selected.length === 0) {
    return {
      errors: [{ code: 'PARTIAL_DATA', message: 'triangulate: no fair-value comps to value from' }],
    };
  }

  const entries = selected.map((c) => ({
    value: c.adjustedValue ?? c.salePrice,
    weight: Math.max(1, c.similarityScore),
  }));
  const weightSum = entries.reduce((a, e) => a + e.weight, 0);
  const compDerived = Math.round(entries.reduce((a, e) => a + e.value * e.weight, 0) / weightSum);

  const values = entries.map((e) => e.value).sort((a, b) => a - b);
  const low = values[0] ?? compDerived;
  const high = values[values.length - 1] ?? compDerived;
  const median = values[Math.floor(values.length / 2)] ?? compDerived;
  const spread = median > 0 ? (high - low) / median : 0;

  const confidence: 'high' | 'medium' | 'low' =
    spread <= 0.1 && selected.length >= 3 ? 'high' : spread <= 0.25 ? 'medium' : 'low';

  const fmt = (n: number) => `$${n.toLocaleString()}`;
  const uncertaintyNote =
    spread > 0.25
      ? `The selected comparables' adjusted values span ${fmt(low)}-${fmt(high)} (a wide range), so treat the estimate as indicative rather than precise.`
      : null;
  const narrative = `Derived from ${selected.length} fair-value comparable${selected.length === 1 ? '' : 's'}; similarity-weighted estimate ${fmt(compDerived)} with a range of ${fmt(low)}-${fmt(high)}.`;

  return {
    triangulation: {
      compDerived,
      low,
      high,
      reconciled: compDerived,
      confidence,
      spread,
      compIds: selected.map((c) => c.id),
      uncertaintyNote,
      narrative,
    },
  };
}
```

- [ ] **Step 3b: Add the `triangulation` channel to `src/agents/annotation.ts`**

Add `TriangulatedValue` to the `@/schemas/state` type import, and add this channel to `Annotation.Root({ … })` (after `comparables`):

```ts
  triangulation: Annotation<TriangulatedValue | null>({ reducer: (_c, u) => u, default: () => null }),
```

- [ ] **Step 4: Run → pass + gate**

```bash
pnpm exec biome check --write src/agents/nodes/07_triangulate.ts src/agents/annotation.ts tests/unit/triangulate.test.ts
pnpm vitest run tests/unit/triangulate.test.ts
pnpm typecheck && pnpm lint && pnpm test
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/nodes/07_triangulate.ts src/agents/annotation.ts tests/unit/triangulate.test.ts
git commit -m "feat: triangulate node (Node 07) + triangulation channel (v2 comp-derived)"
```

---

## Task 3: Wire into the graph

**Files:** Modify `src/agents/graph.ts`, `tests/unit/graph.test.ts`

- [ ] **Step 1: Update `tests/unit/graph.test.ts`** — assert triangulation lands

In the happy-path test, after the `selection` assertion, add:

```ts
    expect(state.triangulation?.reconciled).toBeGreaterThan(0);
```

- [ ] **Step 2: Run → fail**

Run: `pnpm vitest run tests/unit/graph.test.ts`
Expected: FAIL — `state.triangulation` is `null` (triangulate not wired in yet).

- [ ] **Step 3: Wire it in `src/agents/graph.ts`**

Add the import:

```ts
import { triangulate } from '@/agents/nodes/07_triangulate';
```

Change the graph to insert the node after `reasonAndSelect`:

```ts
export const reportGraph = new StateGraph(GraphAnnotation)
  .addNode('resolveAddress', resolveAddress)
  .addNode('fetchCandidateComps', fetchCandidateComps)
  .addNode('reasonAndSelect', reasonAndSelect)
  .addNode('triangulate', triangulate)
  .addEdge(START, 'resolveAddress')
  .addEdge('resolveAddress', 'fetchCandidateComps')
  .addEdge('fetchCandidateComps', 'reasonAndSelect')
  .addEdge('reasonAndSelect', 'triangulate')
  .addEdge('triangulate', END)
  .compile();
```

- [ ] **Step 4: Run → pass + gate**

```bash
pnpm exec biome check --write src/agents/graph.ts tests/unit/graph.test.ts
pnpm vitest run tests/unit/graph.test.ts
pnpm typecheck && pnpm lint && pnpm test
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/graph.ts tests/unit/graph.test.ts
git commit -m "feat: wire triangulate into the graph (... -> triangulate -> END)"
```

---

## Self-review (done while writing)

- **Spec coverage:** §2 schema → Task 1. §3 node → Task 2. §4 wiring → Tasks 2 (channel) + 3 (graph). §5 tests → schema rewrite + node tests + graph update.
- **Placeholder scan:** none — full code in every step.
- **Type consistency:** `TriangulatedValue` (Task 1) used by the annotation channel (Task 2) and the node return; node filters `selection==='fair-value'`, uses `adjustedValue ?? salePrice` + `similarityScore`; `confidence` annotated to the literal union; the returned object satisfies the schema's refine (spread>0.25 ⇒ confidence 'low' + note, guaranteed by the branch logic); `sampleComparable` (from the Node 06 increment) is reused with `selection`/`adjustedValue` overrides.

## Done criteria

- v2 `TriangulatedValueSchema`; deterministic `triangulate` node + channel; graph runs `… → triangulate → END`.
- All tests green; `pnpm typecheck && pnpm lint && pnpm test` pass; `CLAUDE.md` untouched.
