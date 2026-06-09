# Node 06 reasonAndSelect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the LLM keystone node `reasonAndSelect` that turns the ranked candidate comps into selected fair-value/anchor comps with per-dimension adjustments, and wire it into the graph.

**Architecture:** Four dependency-ordered tasks — (1) simplify the LLM adjustment schema, (2) the prompt module, (3) the node (maps LLM decisions onto `state.comparables`, mocking `callWithFallback` in tests to avoid the model + DB), (4) graph wiring + graph-test update.

**Tech Stack:** `@langchain/langgraph@0.2.34`, Zod 3.25, Vitest 2.1 (module-mock `@/tools/llm/structuredCall`), Biome. `@/` → `src/`.

**Reference spec:** `docs/superpowers/specs/2026-05-30-node06-reasonAndSelect-design.md`

**Verified:** `callWithFallback(opts)` takes `StructuredCallOpts` `{model, reasoningEffort?, schema, messages, node, promptVersion?}`; `ReasonSelectOutputSchema`/`ComparableDecisionSchema`/`ReasonSelectAdjustmentSchema` are referenced nowhere yet (safe to change); `Comparable.adjustments` = `{dimension, deltaPct, rationale, sourceRef: SourceRef[]}`; `provider:'llm'` is in `ProviderSchema`; the DB ledger write lives inside `structuredCall`, so mocking `callWithFallback` avoids it.

---

## File map

| File | Action |
|---|---|
| `src/schemas/reasonSelect.ts` | Modify (drop `sourceRef` from `ReasonSelectAdjustmentSchema`) |
| `src/prompts/reasonAndSelect.ts` | Create |
| `src/agents/nodes/06_reasonAndSelect.ts` | Create |
| `src/agents/graph.ts` | Modify (wire the node) |
| `tests/fixtures/comps.ts` | Modify (add `sampleComparable`) |
| `tests/unit/{reasonSelect.schema,reasonAndSelect.prompt,reasonAndSelect}.test.ts` | Create |
| `tests/unit/graph.test.ts` | Modify (mock the LLM) |

---

## Task 1: Simplify the LLM adjustment schema

**Files:** Modify `src/schemas/reasonSelect.ts`; Test `tests/unit/reasonSelect.schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/reasonSelect.schema.test.ts
import { ReasonSelectOutputSchema } from '@/schemas/reasonSelect';
import { describe, expect, it } from 'vitest';

const decision = {
  compId: 'c1',
  selection: 'fair-value' as const,
  rejectionReason: null,
  adjustments: [{ dimension: 'land-area', delta: 0.05, rationale: 'subject has more land than this comp' }],
  adjustmentNarrative: 'Adjusted up modestly for the larger parcel and similar condition overall.',
  adjustedValue: 2_600_000,
  selectionRationale: 'Strong like-for-like match on beds, baths and street quality.',
};

describe('ReasonSelectOutputSchema', () => {
  it('accepts an adjustment with no sourceRef (LLM does not emit pointers)', () => {
    const parsed = ReasonSelectOutputSchema.parse({ decisions: [decision] });
    expect(parsed.decisions[0]?.adjustments[0]).toEqual({
      dimension: 'land-area',
      delta: 0.05,
      rationale: 'subject has more land than this comp',
    });
  });

  it('rejects a delta outside [-0.3, 0.3]', () => {
    const bad = { ...decision, adjustments: [{ dimension: 'x', delta: 0.5, rationale: 'way too large an adjustment here' }] };
    expect(ReasonSelectOutputSchema.safeParse({ decisions: [bad] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `pnpm vitest run tests/unit/reasonSelect.schema.test.ts`
Expected: FAIL — the parsed adjustment still carries a `sourceRef` requirement (parse throws on the missing field).

- [ ] **Step 3: Edit `src/schemas/reasonSelect.ts`**

Replace `ReasonSelectAdjustmentSchema` with (no `sourceRef`):

```ts
export const ReasonSelectAdjustmentSchema = z.object({
  dimension: z.string(),
  delta: z.number().min(-0.3).max(0.3),
  rationale: z.string().min(20),
});
```

Remove the now-unused `import { SourceRefSchema } from './sources';` line.

- [ ] **Step 4: Run → pass + gate**

```bash
pnpm exec biome check --write src/schemas/reasonSelect.ts tests/unit/reasonSelect.schema.test.ts
pnpm vitest run tests/unit/reasonSelect.schema.test.ts
pnpm typecheck && pnpm lint && pnpm test
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schemas/reasonSelect.ts tests/unit/reasonSelect.schema.test.ts
git commit -m "refactor: reasonSelect adjustment drops sourceRef (node stamps provenance)"
```

---

## Task 2: Prompt module

**Files:** Create `src/prompts/reasonAndSelect.ts`; Test `tests/unit/reasonAndSelect.prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/reasonAndSelect.prompt.test.ts
import { buildMessages, version } from '@/prompts/reasonAndSelect';
import { describe, expect, it } from 'vitest';

const input = {
  subject: { suburb: 'Mosman', attrs: { beds: 3, baths: 2, parking: 1, landArea: 500, buildingArea: null, propertyType: 'House' } },
  comps: [
    { id: 'A', address: 'A St', salePrice: 2_000_000, contractDate: '2026-03-01', distanceM: 100, beds: 3, baths: 2, landArea: 480, propertyType: 'House', similarityScore: 90 },
  ],
};

describe('reasonAndSelect prompt', () => {
  it('has a non-empty version', () => {
    expect(version.length).toBeGreaterThan(0);
  });
  it('builds a system+user pair carrying the suburb and every comp id', () => {
    const msgs = buildMessages(input);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[1]?.role).toBe('user');
    expect(msgs[1]?.content).toContain('Mosman');
    expect(msgs[1]?.content).toContain('"A"');
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `pnpm vitest run tests/unit/reasonAndSelect.prompt.test.ts`
Expected: FAIL — `Cannot find module '@/prompts/reasonAndSelect'`.

- [ ] **Step 3: Create `src/prompts/reasonAndSelect.ts`**

```ts
// src/prompts/reasonAndSelect.ts — Node 06 prompt (CLAUDE.md §7.8). Bump `version`
// when the wording changes ([R30]).

import type { LlmMessage } from '@/tools/llm/types';

export const version = 'v1.0';

export interface ReasonSelectComp {
  id: string;
  address: string;
  salePrice: number;
  contractDate: string;
  distanceM: number;
  beds: number;
  baths: number;
  landArea: number | null;
  propertyType: string;
  similarityScore: number;
}

export interface ReasonSelectPromptInput {
  subject: {
    suburb: string;
    attrs: {
      beds: number;
      baths: number;
      parking: number;
      landArea: number | null;
      buildingArea: number | null;
      propertyType: string;
    };
  };
  comps: ReasonSelectComp[];
}

const SYSTEM = `You are a property valuation analyst selecting and adjusting comparable sales for a subject property in Australia.

Rules:
- Never invent attributes not given.
- Express each adjustment as a percentage delta in [-0.30, 0.30]; positive means the SUBJECT is worth MORE than the comp on that dimension.
- Total adjustments per comp should rarely exceed ±15%. If a comp needs more, mark it "rejected" with a rejectionReason.
- Select 4-5 comps as "fair-value" and 2-3 as "negotiation-anchor". Mark all others "rejected".
- Return exactly one decision for every comp id provided. Each decision: compId, selection, rejectionReason (null unless rejected), adjustments[] (dimension, delta, rationale >=20 chars), adjustmentNarrative (>=60 chars), adjustedValue (the comp's sale price adjusted toward the subject, in AUD), selectionRationale (>=40 chars).`;

export function buildMessages(input: ReasonSelectPromptInput): LlmMessage[] {
  const user = `Subject (suburb ${input.subject.suburb}):\n${JSON.stringify(input.subject.attrs)}\n\nCandidate comparables (${input.comps.length}):\n${JSON.stringify(input.comps)}`;
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];
}
```

- [ ] **Step 4: Run → pass + gate**

```bash
pnpm exec biome check --write src/prompts/reasonAndSelect.ts tests/unit/reasonAndSelect.prompt.test.ts
pnpm vitest run tests/unit/reasonAndSelect.prompt.test.ts
pnpm typecheck && pnpm lint && pnpm test
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/prompts/reasonAndSelect.ts tests/unit/reasonAndSelect.prompt.test.ts
git commit -m "feat: reasonAndSelect prompt module (v1.0)"
```

---

## Task 3: The node

**Files:** Create `src/agents/nodes/06_reasonAndSelect.ts`; Modify `tests/fixtures/comps.ts` (add `sampleComparable`); Test `tests/unit/reasonAndSelect.test.ts`

- [ ] **Step 1: Add `sampleComparable` to `tests/fixtures/comps.ts`**

Add `Comparable` to the existing `@/schemas/state` type import, and append:

```ts
export function sampleComparable(id: string, over: Partial<Comparable> = {}): Comparable {
  return {
    id,
    address: `${id} St, Mosman NSW 2088`,
    salePrice: 2_500_000,
    contractDate: '2026-03-01',
    distanceM: 300,
    beds: 3,
    baths: 2,
    landArea: 500,
    propertyType: 'House',
    photos: [],
    visionAnalysis: null,
    similarityScore: 80,
    selection: 'candidate',
    adjustments: [],
    adjustedValue: null,
    adjustmentNarrative: null,
    source: {
      provider: 'rea',
      endpoint: '/properties/search?channel=sold',
      fetchedAt: '2026-05-30T00:00:00.000Z',
      path: '/comparables/0/salePrice',
    },
    ...over,
  };
}
```

- [ ] **Step 2: Write the node test**

```ts
// tests/unit/reasonAndSelect.test.ts
import { graphState, sampleComparable } from '../fixtures/comps';
import { reasonAndSelect } from '@/agents/nodes/06_reasonAndSelect';
import { callWithFallback } from '@/tools/llm/structuredCall';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/tools/llm/structuredCall', () => ({ callWithFallback: vi.fn() }));
const mockLlm = vi.mocked(callWithFallback);

const decision = (compId: string, selection: 'fair-value' | 'rejected') => ({
  compId,
  selection,
  rejectionReason: selection === 'rejected' ? 'too dissimilar to the subject property' : null,
  adjustments: selection === 'fair-value' ? [{ dimension: 'land-area', delta: 0.05, rationale: 'subject parcel is a little larger than this comp' }] : [],
  adjustmentNarrative: 'Adjusted modestly for parcel size; otherwise a close like-for-like comparison overall.',
  adjustedValue: 2_600_000,
  selectionRationale: 'Close match on beds, baths and proximity to the subject property.',
});

beforeEach(() => mockLlm.mockReset());

describe('reasonAndSelect', () => {
  it('maps decisions onto the matching comps', async () => {
    mockLlm.mockResolvedValue({ decisions: [decision('A', 'fair-value'), decision('B', 'rejected')] });
    const state = graphState({ comparables: [sampleComparable('A'), sampleComparable('B'), sampleComparable('C')] });
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
    await expect(reasonAndSelect(graphState({ comparables: [sampleComparable('A')] }))).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run → fail**

Run: `pnpm vitest run tests/unit/reasonAndSelect.test.ts`
Expected: FAIL — `Cannot find module '@/agents/nodes/06_reasonAndSelect'`.

- [ ] **Step 4: Create `src/agents/nodes/06_reasonAndSelect.ts`**

```ts
// src/agents/nodes/06_reasonAndSelect.ts — Node 06 keystone (CLAUDE.md §7.8).
// Selects + adjusts the candidate comps via the LLM, merges decisions back onto
// state.comparables. LLM-unavailable propagates (retryable; not an in-band degrade).

import type { GraphState } from '@/agents/annotation';
import { type ReasonSelectComp, buildMessages, version } from '@/prompts/reasonAndSelect';
import { ReasonSelectOutputSchema } from '@/schemas/reasonSelect';
import type { Comparable } from '@/schemas/state';
import { callWithFallback } from '@/tools/llm/structuredCall';

function toCompSummary(c: Comparable): ReasonSelectComp {
  return {
    id: c.id,
    address: c.address,
    salePrice: c.salePrice,
    contractDate: c.contractDate,
    distanceM: c.distanceM,
    beds: c.beds,
    baths: c.baths,
    landArea: c.landArea,
    propertyType: c.propertyType,
    similarityScore: c.similarityScore,
  };
}

export async function reasonAndSelect(state: GraphState): Promise<Partial<GraphState>> {
  const { subject, resolvedAddress, comparables } = state;
  if (!subject || comparables.length === 0) {
    return {
      errors: [{ code: 'PARTIAL_DATA', message: 'reasonAndSelect: no subject or no candidate comps' }],
    };
  }

  const out = await callWithFallback({
    model: process.env.OPENAI_MODEL_REASONING ?? '',
    reasoningEffort: 'high',
    schema: ReasonSelectOutputSchema,
    node: 'reasonAndSelect',
    promptVersion: version,
    messages: buildMessages({
      subject: { suburb: resolvedAddress?.suburb ?? '', attrs: subject.attrs },
      comps: comparables.map(toCompSummary),
    }),
  });

  const byId = new Map(out.decisions.map((d) => [d.compId, d]));
  const updated: Comparable[] = comparables.map((c, i) => {
    const d = byId.get(c.id);
    if (!d) return c;
    return {
      ...c,
      selection: d.selection,
      adjustedValue: d.adjustedValue,
      adjustmentNarrative: d.adjustmentNarrative,
      adjustments: d.adjustments.map((a) => ({
        dimension: a.dimension,
        deltaPct: a.delta,
        rationale: a.rationale,
        sourceRef: [
          {
            provider: 'llm' as const,
            endpoint: 'node:reasonAndSelect',
            fetchedAt: new Date().toISOString(),
            path: `/comparables/${i}/salePrice`,
          },
        ],
      })),
    };
  });

  return { comparables: updated };
}
```

- [ ] **Step 5: Run → pass + gate**

```bash
pnpm exec biome check --write src/agents/nodes/06_reasonAndSelect.ts tests/fixtures/comps.ts tests/unit/reasonAndSelect.test.ts
pnpm vitest run tests/unit/reasonAndSelect.test.ts
pnpm typecheck && pnpm lint && pnpm test
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agents/nodes/06_reasonAndSelect.ts tests/fixtures/comps.ts tests/unit/reasonAndSelect.test.ts
git commit -m "feat: reasonAndSelect node (Node 06) maps LLM decisions onto comparables"
```

---

## Task 4: Wire into the graph

**Files:** Modify `src/agents/graph.ts`, `tests/unit/graph.test.ts`

- [ ] **Step 1: Update `tests/unit/graph.test.ts`** — mock the LLM and assert selection lands

At the top (with the other imports), add the module mock and import:

```ts
import { callWithFallback } from '@/tools/llm/structuredCall';
vi.mock('@/tools/llm/structuredCall', () => ({ callWithFallback: vi.fn() }));
const mockLlm = vi.mocked(callWithFallback);
```

In `beforeEach`, after the env setup, add a default decision set for the two seeded comps:

```ts
  mockLlm.mockReset();
  mockLlm.mockResolvedValue({
    decisions: [
      { compId: 'NEAR', selection: 'fair-value', rejectionReason: null, adjustments: [{ dimension: 'land-area', delta: 0.05, rationale: 'subject parcel is slightly larger than this comp' }], adjustmentNarrative: 'Adjusted modestly; otherwise a close like-for-like comparison overall here.', adjustedValue: 2_600_000, selectionRationale: 'Close match on beds, baths and proximity to the subject.' },
      { compId: 'FAR', selection: 'rejected', rejectionReason: 'too far and bedroom count differs', adjustments: [], adjustmentNarrative: 'Rejected: distance and bedroom mismatch make this an unreliable comparison here.', adjustedValue: 4_000_000, selectionRationale: 'Excluded from the fair-value set due to distance and size mismatch.' },
    ],
  });
```

In the happy-path test, after the existing comparables assertion, add:

```ts
    expect(state.comparables.find((c) => c.id === 'NEAR')?.selection).toBe('fair-value');
```

- [ ] **Step 2: Run → fail**

Run: `pnpm vitest run tests/unit/graph.test.ts`
Expected: FAIL — `NEAR` is still `candidate` (reasonAndSelect not wired into the graph yet).

- [ ] **Step 3: Wire it in `src/agents/graph.ts`**

Add the import:

```ts
import { reasonAndSelect } from '@/agents/nodes/06_reasonAndSelect';
```

Change the graph to insert the node after `fetchCandidateComps`:

```ts
export const reportGraph = new StateGraph(GraphAnnotation)
  .addNode('resolveAddress', resolveAddress)
  .addNode('fetchCandidateComps', fetchCandidateComps)
  .addNode('reasonAndSelect', reasonAndSelect)
  .addEdge(START, 'resolveAddress')
  .addEdge('resolveAddress', 'fetchCandidateComps')
  .addEdge('fetchCandidateComps', 'reasonAndSelect')
  .addEdge('reasonAndSelect', END)
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
git commit -m "feat: wire reasonAndSelect into the graph (... -> reasonAndSelect -> END)"
```

---

## Self-review (done while writing)

- **Spec coverage:** §3 schema → Task 1. §4 prompt → Task 2. §5 node → Task 3. §6 wiring → Task 4. §7 tests → schema/prompt/node tests + graph update. §8 out-of-scope — nothing here touches triangulate/compose/render/vision.
- **Placeholder scan:** none — full code in every step.
- **Type consistency:** `ReasonSelectComp`/`buildMessages`/`version` (Task 2) consumed by the node (Task 3); `ReasonSelectOutputSchema` (Task 1) is the node's call schema; node returns `Comparable[]` via the `: Comparable[]` annotation, with `delta→deltaPct` and a `provider:'llm'` `sourceRef[]`; `sampleComparable` (Task 3) used by the node test; the graph test's mocked `callWithFallback` returns decisions for the `NEAR`/`FAR` ids `mockReaOk` produces.

## Done criteria

- `ReasonSelectAdjustmentSchema` simplified; prompt module + node implemented; graph runs `… → reasonAndSelect → END`.
- All new + updated tests green; `pnpm typecheck && pnpm lint && pnpm test` all pass; `CLAUDE.md` untouched.
