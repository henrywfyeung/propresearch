# Node 10 compose (v0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `compose` node that writes the four core report sections (`summary`, `subject`, `valuation`, `comparables`) as `ReportProse` — LLM narrative `text` blocks plus a node-stamped valuation `range` claim.

**Architecture:** Three tasks — (1) compose prompt module, (2) the node + `prose` channel, (3) graph wiring + graph-test update. The four section calls run in parallel; the LLM output is `text`-only (the node stamps the one structured claim). Tests mock `callWithFallback`.

**Tech Stack:** Zod 3.25, `@langchain/langgraph@0.2.34`, Vitest 2.1 (module-mock the LLM), Biome. `@/` → `src/`. `noUncheckedIndexedAccess` on.

**Reference spec:** `docs/superpowers/specs/2026-05-30-node10-compose-design.md`

**Verified:** `ClaimBlockSchema` (text/claim/range/comp-ref), `ReportProseSchema = z.record(SectionIdSchema, ClaimBlock[])`, `ClaimFormat` includes `currency-aud` — all in `src/schemas/claims.ts`. `callWithFallback(opts)` takes `{model, schema, messages, node, promptVersion?}`. `provider:'derived'` is in `ProviderSchema`.

---

## File map

| File | Action |
|---|---|
| `src/prompts/compose.ts` | Create |
| `src/agents/nodes/10_compose.ts` | Create |
| `src/agents/annotation.ts` | Modify (+`prose` channel) |
| `src/agents/graph.ts` | Modify (wire node) |
| `tests/unit/{compose.prompt,compose}.test.ts` | Create |
| `tests/unit/graph.test.ts` | Modify (node-keyed LLM mock) |

---

## Task 1: compose prompt module

**Files:** Create `src/prompts/compose.ts`; Test `tests/unit/compose.prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/compose.prompt.test.ts
import { buildMessages, version } from '@/prompts/compose';
import { describe, expect, it } from 'vitest';

const input = {
  suburb: 'Mosman',
  subjectAttrs: { beds: 3, baths: 2, parking: 1, landArea: 500, buildingArea: null, propertyType: 'House' },
  triangulation: { compDerived: 2_500_000, low: 2_400_000, high: 2_600_000, reconciled: 2_500_000, confidence: 'high' as const, spread: 0.08 },
  selectedComps: [{ id: 'A', address: 'A St', salePrice: 2_400_000, adjustedValue: 2_500_000, contractDate: '2026-03-01', beds: 3, baths: 2, propertyType: 'House', selection: 'fair-value' }],
};

describe('compose prompt', () => {
  it('has a non-empty version', () => {
    expect(version.length).toBeGreaterThan(0);
  });
  it('builds a system+user pair naming the section and carrying the suburb', () => {
    const msgs = buildMessages('valuation', input);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toContain('valuation');
    expect(msgs[1]?.role).toBe('user');
    expect(msgs[1]?.content).toContain('Mosman');
  });
});
```

- [ ] **Step 2: Run → fail** — Run: `pnpm vitest run tests/unit/compose.prompt.test.ts` — Expected: `Cannot find module '@/prompts/compose'`.

- [ ] **Step 3: Create `src/prompts/compose.ts`**

```ts
// src/prompts/compose.ts — Node 10 section prompts (CLAUDE.md §7.12). Bump
// `version` on wording changes ([R30]). Output is text-only narrative blocks;
// the node stamps the structured valuation claim.

import type { LlmMessage } from '@/tools/llm/types';

export const version = 'v1.0';

export type ComposeSection = 'summary' | 'subject' | 'valuation' | 'comparables';

export interface ComposeInput {
  suburb: string;
  subjectAttrs: {
    beds: number;
    baths: number;
    parking: number;
    landArea: number | null;
    buildingArea: number | null;
    propertyType: string;
  };
  triangulation: {
    compDerived: number;
    low: number;
    high: number;
    reconciled: number;
    confidence: 'high' | 'medium' | 'low';
    spread: number;
  } | null;
  selectedComps: Array<{
    id: string;
    address: string;
    salePrice: number;
    adjustedValue: number | null;
    contractDate: string;
    beds: number;
    baths: number;
    propertyType: string;
    selection: string;
  }>;
}

const VOICE =
  'Voice: direct, confident, specific. No marketing language. Plain Australian English. Prices in AUD. Output ONLY a JSON array of {"type":"text","text":"..."} blocks of narrative prose.';

const SECTION_BRIEF: Record<ComposeSection, string> = {
  summary: 'Write the executive summary: the headline verdict on the property and where its value sits.',
  subject: 'Describe the subject property from its attributes (beds, baths, parking, land, type).',
  valuation: 'Explain how the comparable sales support the estimated value range, and what the confidence and any uncertainty mean for a buyer.',
  comparables: 'Walk through the selected comparable sales and why they were chosen.',
};

export function buildMessages(section: ComposeSection, input: ComposeInput): LlmMessage[] {
  const system = `You are writing the "${section}" section of a residential property research dossier. ${SECTION_BRIEF[section]} ${VOICE}`;
  const user = `Suburb: ${input.suburb}\nSubject attributes: ${JSON.stringify(input.subjectAttrs)}\nValuation: ${JSON.stringify(input.triangulation)}\nSelected comparables: ${JSON.stringify(input.selectedComps)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
```

- [ ] **Step 4: Run → pass + gate** — `pnpm exec biome check --write src/prompts/compose.ts tests/unit/compose.prompt.test.ts` then `pnpm vitest run tests/unit/compose.prompt.test.ts` then `pnpm typecheck && pnpm lint && pnpm test`. Expected: all PASS.

- [ ] **Step 5: Commit** — `git add src/prompts/compose.ts tests/unit/compose.prompt.test.ts && git commit -m "feat: compose section prompts (v1.0)"`

---

## Task 2: compose node + prose channel

**Files:** Create `src/agents/nodes/10_compose.ts`; Modify `src/agents/annotation.ts` (+`prose` channel); Test `tests/unit/compose.test.ts`

- [ ] **Step 1: Write the node test**

```ts
// tests/unit/compose.test.ts
import { graphState, sampleComparable } from '../fixtures/comps';
import { compose } from '@/agents/nodes/10_compose';
import { callWithFallback } from '@/tools/llm/structuredCall';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/tools/llm/structuredCall', () => ({ callWithFallback: vi.fn() }));
const mockLlm = vi.mocked(callWithFallback);

const tri = { compDerived: 2_500_000, low: 2_400_000, high: 2_600_000, reconciled: 2_500_000, confidence: 'high' as const, spread: 0.08, compIds: ['a'], uncertaintyNote: null, narrative: 'Derived from fair-value comparables across the suburb.' };

beforeEach(() => {
  mockLlm.mockReset();
  mockLlm.mockResolvedValue([{ type: 'text', text: 'Section narrative prose.' }]);
});

describe('compose', () => {
  it('writes all four sections and stamps the valuation range first', async () => {
    const state = graphState({
      comparables: [sampleComparable('a', { selection: 'fair-value', adjustedValue: 2_500_000 })],
      triangulation: tri,
    });
    const out = await compose(state);
    expect(Object.keys(out.prose ?? {}).sort()).toEqual(['comparables', 'subject', 'summary', 'valuation']);
    const first = out.prose?.valuation?.[0];
    expect(first?.type).toBe('range');
    if (first?.type === 'range') {
      expect(first.low).toBe(2_400_000);
      expect(first.high).toBe(2_600_000);
      expect(first.sourceRef.path).toBe('/triangulation/reconciled');
    }
    expect(mockLlm).toHaveBeenCalledTimes(4);
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
```

- [ ] **Step 2: Run → fail** — Run: `pnpm vitest run tests/unit/compose.test.ts` — Expected: `Cannot find module '@/agents/nodes/10_compose'`.

- [ ] **Step 3a: Create `src/agents/nodes/10_compose.ts`**

```ts
// src/agents/nodes/10_compose.ts — Node 10 (CLAUDE.md §7.12, v0). Writes the four
// core sections in parallel as text-block narrative; stamps the valuation range
// claim deterministically from state.triangulation.

import type { GraphState } from '@/agents/annotation';
import { type ComposeInput, type ComposeSection, buildMessages, version } from '@/prompts/compose';
import type { ClaimBlock, ReportProse } from '@/schemas/claims';
import type { Comparable } from '@/schemas/state';
import { callWithFallback } from '@/tools/llm/structuredCall';
import { z } from 'zod';

const SECTIONS: ComposeSection[] = ['summary', 'subject', 'valuation', 'comparables'];
const TextBlocksSchema = z.array(z.object({ type: z.literal('text'), text: z.string().min(1) }));

function toCompSummary(c: Comparable): ComposeInput['selectedComps'][number] {
  return {
    id: c.id,
    address: c.address,
    salePrice: c.salePrice,
    adjustedValue: c.adjustedValue,
    contractDate: c.contractDate,
    beds: c.beds,
    baths: c.baths,
    propertyType: c.propertyType,
    selection: c.selection,
  };
}

export async function compose(state: GraphState): Promise<Partial<GraphState>> {
  const { subject, resolvedAddress, comparables, triangulation } = state;
  if (!subject) {
    return { errors: [{ code: 'PARTIAL_DATA', message: 'compose: no subject' }] };
  }

  const input: ComposeInput = {
    suburb: resolvedAddress?.suburb ?? '',
    subjectAttrs: subject.attrs,
    triangulation,
    selectedComps: comparables
      .filter((c) => c.selection === 'fair-value' || c.selection === 'negotiation-anchor')
      .map(toCompSummary),
  };

  const entries = await Promise.all(
    SECTIONS.map(async (section): Promise<[ComposeSection, ClaimBlock[]]> => {
      const blocks = await callWithFallback({
        model: process.env.OPENAI_MODEL_COMPOSE ?? '',
        schema: TextBlocksSchema,
        node: `compose:${section}`,
        promptVersion: version,
        messages: buildMessages(section, input),
      });
      return [section, blocks];
    }),
  );

  const prose = Object.fromEntries(entries) as ReportProse;

  if (triangulation) {
    prose.valuation = [
      {
        type: 'range',
        text: 'Estimated value {{lo}}-{{hi}}',
        low: triangulation.low,
        high: triangulation.high,
        format: 'currency-aud',
        sourceRef: {
          provider: 'derived',
          endpoint: 'node:triangulate',
          fetchedAt: new Date().toISOString(),
          path: '/triangulation/reconciled',
        },
      },
      ...(prose.valuation ?? []),
    ];
  }

  return { prose };
}
```

- [ ] **Step 3b: Add the `prose` channel to `src/agents/annotation.ts`**

Add `ReportProse` to the imports (from `@/schemas/claims`) and add this channel to `Annotation.Root({ … })`:

```ts
  prose: Annotation<ReportProse>({ reducer: (cur, inc) => ({ ...cur, ...inc }), default: () => ({}) }),
```

- [ ] **Step 4: Run → pass + gate** — `pnpm exec biome check --write src/agents/nodes/10_compose.ts src/agents/annotation.ts tests/unit/compose.test.ts` then `pnpm vitest run tests/unit/compose.test.ts` then `pnpm typecheck && pnpm lint && pnpm test`. Expected: all PASS.

- [ ] **Step 5: Commit** — `git add src/agents/nodes/10_compose.ts src/agents/annotation.ts tests/unit/compose.test.ts && git commit -m "feat: compose node (Node 10) + prose channel (4 core sections)"`

---

## Task 3: Wire into the graph

**Files:** Modify `src/agents/graph.ts`, `tests/unit/graph.test.ts`

- [ ] **Step 1: Update `tests/unit/graph.test.ts`** — the LLM mock now serves two node families. Replace the existing `mockLlm.mockResolvedValue({ decisions: … })` setup with a node-keyed implementation:

```ts
  mockLlm.mockReset();
  mockLlm.mockImplementation(async (opts: { node: string }) => {
    if (opts.node === 'reasonAndSelect') {
      return {
        decisions: [
          { compId: 'NEAR', selection: 'fair-value', rejectionReason: null, adjustments: [{ dimension: 'land-area', delta: 0.05, rationale: 'subject parcel is slightly larger than this comp' }], adjustmentNarrative: 'Adjusted modestly; otherwise a close like-for-like comparison overall here.', adjustedValue: 2_600_000, selectionRationale: 'Close match on beds, baths and proximity to the subject.' },
          { compId: 'FAR', selection: 'rejected', rejectionReason: 'too far and bedroom count differs', adjustments: [], adjustmentNarrative: 'Rejected: distance and bedroom mismatch make this an unreliable comparison here.', adjustedValue: 4_000_000, selectionRationale: 'Excluded from the fair-value set due to distance and size mismatch.' },
        ],
      } as never;
    }
    if (opts.node.startsWith('compose:')) {
      return [{ type: 'text', text: 'Section narrative prose for the dossier.' }] as never;
    }
    throw new Error(`unexpected LLM node: ${opts.node}`);
  });
```

In the happy-path test, after the `triangulation` assertion, add:

```ts
    expect(state.prose.valuation?.[0]?.type).toBe('range');
```

- [ ] **Step 2: Run → fail** — Run: `pnpm vitest run tests/unit/graph.test.ts` — Expected: FAIL — `state.prose.valuation` is undefined (compose not wired in).

- [ ] **Step 3: Wire it in `src/agents/graph.ts`** — add `import { compose } from '@/agents/nodes/10_compose';` and:

```ts
export const reportGraph = new StateGraph(GraphAnnotation)
  .addNode('resolveAddress', resolveAddress)
  .addNode('fetchCandidateComps', fetchCandidateComps)
  .addNode('reasonAndSelect', reasonAndSelect)
  .addNode('triangulate', triangulate)
  .addNode('compose', compose)
  .addEdge(START, 'resolveAddress')
  .addEdge('resolveAddress', 'fetchCandidateComps')
  .addEdge('fetchCandidateComps', 'reasonAndSelect')
  .addEdge('reasonAndSelect', 'triangulate')
  .addEdge('triangulate', 'compose')
  .addEdge('compose', END)
  .compile();
```

- [ ] **Step 4: Run → pass + gate** — `pnpm exec biome check --write src/agents/graph.ts tests/unit/graph.test.ts` then `pnpm vitest run tests/unit/graph.test.ts` then `pnpm typecheck && pnpm lint && pnpm test`. Expected: all PASS.

- [ ] **Step 5: Commit** — `git add src/agents/graph.ts tests/unit/graph.test.ts && git commit -m "feat: wire compose into the graph (... -> compose -> END)"`

---

## Self-review (done while writing)

- **Spec coverage:** §2 channel → Task 2. §3 prompt → Task 1. §4 node → Task 2. §5 wiring → Task 3. §6 tests → prompt/node tests + node-keyed graph mock.
- **Placeholder scan:** none — full code in every step.
- **Type consistency:** `ComposeSection`/`ComposeInput`/`buildMessages`/`version` (Task 1) consumed by the node (Task 2); `TextBlocksSchema` element is a structural `ClaimBlock` (text variant); `ReportProse` cast on `Object.fromEntries`; the stamped `range` block is a full `ClaimBlock` with `provider:'derived'`; graph mock keys on `opts.node` so both `reasonAndSelect` and `compose:*` calls resolve.

## Done criteria

- `prose` channel; compose prompt module + node (4 parallel sections + stamped valuation range); graph runs `… → compose → END`.
- All tests green; `pnpm typecheck && pnpm lint && pnpm test` pass; `CLAUDE.md` untouched.
