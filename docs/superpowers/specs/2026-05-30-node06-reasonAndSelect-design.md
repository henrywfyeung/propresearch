# Design: Node 06 `reasonAndSelect` (LLM comp selection + adjustment)

- **Date:** 2026-05-30
- **Status:** Design (autonomous — owner delegated decisions; not billing-related)
- **Scope:** The LLM keystone node that turns the ranked candidate comps into selected fair-value/negotiation-anchor comps with per-dimension adjustments + adjusted values.
- **Builds on:** the graph (`resolveAddress → fetchCandidateComps`), the LLM layer (`callWithFallback`, `ReasonSelectOutputSchema`).

---

## 1. Context

`fetchCandidateComps` produces 30 scored candidates (all `selection:'candidate'`). Node 06 (CLAUDE.md §7.8, Appendix B) is the deepest LLM call: it reviews the candidates against the subject and returns, per comp, a `selection`, per-dimension `adjustments`, an `adjustedValue`, and rationales. The node merges those decisions back onto `state.comparables`. This is the input to Node 07 `triangulate` (later).

## 2. Decisions (autonomous)

- **D1 — LLM adjustment schema simplified.** `ReasonSelectAdjustmentSchema` drops its `sourceRef` (an LLM shouldn't fabricate RFC-6901 pointers). The LLM returns `{dimension, delta, rationale}`. The node builds the `Comparable.adjustments[].sourceRef` itself (`provider:'llm'`, `endpoint:'node:reasonAndSelect'`, `path:'/comparables/<i>/salePrice'`). `ReasonSelectAdjustmentSchema`/`ComparableDecisionSchema`/`ReasonSelectOutputSchema` are referenced nowhere yet, so this is a free change.
- **D2 — mapping.** For each comp, find its decision by `compId`; set `selection`, `adjustedValue`, `adjustmentNarrative`, and `adjustments = decision.adjustments.map(a => ({ dimension: a.dimension, deltaPct: a.delta, rationale: a.rationale, sourceRef: [stamp(i)] }))`. Comps with no decision stay unchanged (`candidate`); decisions for unknown `compId`s are ignored.
- **D3 — failure mode.** `callWithFallback` throwing (e.g. `LlmProvidersUnavailableError`) **propagates** out of the node (hard fail; the error is retryable — the future Inngest wrapper retries). Not an in-band degrade — without selection there is no valuation.
- **D4 — prompt module.** `src/prompts/reasonAndSelect.ts` exports a `version` ([R30]) + `buildMessages(input)`. Call uses `model = env.OPENAI_MODEL_REASONING`, `reasoningEffort:'high'`, `node:'reasonAndSelect'`, `promptVersion`.

## 3. LLM output schema change — `src/schemas/reasonSelect.ts`

```ts
export const ReasonSelectAdjustmentSchema = z.object({
  dimension: z.string(),
  delta: z.number().min(-0.3).max(0.3),
  rationale: z.string().min(20),
});
// ComparableDecisionSchema + ReasonSelectOutputSchema unchanged otherwise.
// Remove the now-unused SourceRefSchema import.
```

## 4. Prompt module — `src/prompts/reasonAndSelect.ts`

```ts
export const version = 'v1.0';
export interface ReasonSelectPromptInput {
  subject: { suburb: string; attrs: { beds; baths; parking; landArea; buildingArea; propertyType } };
  comps: Array<{ id; address; salePrice; contractDate; distanceM; beds; baths; landArea; propertyType; similarityScore }>;
}
export function buildMessages(input): LlmMessage[]; // system rules (§7.8) + user payload (subject + comps as JSON)
```

System rules (from §7.8): never invent attributes; adjustments are %-deltas (positive = subject worth **more**); total per comp rarely exceeds ±15% — beyond that, reject the comp; select **4–5 `fair-value`** and **2–3 `negotiation-anchor`**, mark the rest `rejected` with a `rejectionReason`; return a decision for every comp id provided.

## 5. Node — `src/agents/nodes/06_reasonAndSelect.ts`

```ts
export async function reasonAndSelect(state: GraphState): Promise<Partial<GraphState>> {
  const { subject, resolvedAddress, comparables } = state;
  if (!subject || comparables.length === 0) {
    return { errors: [{ code: 'PARTIAL_DATA', message: 'reasonAndSelect: no subject or no candidates' }] };
  }
  const out = await callWithFallback({
    model: process.env.OPENAI_MODEL_REASONING ?? '',
    reasoningEffort: 'high',
    schema: ReasonSelectOutputSchema,
    node: 'reasonAndSelect',
    promptVersion: version,
    messages: buildMessages({ subject: { suburb: resolvedAddress?.suburb ?? '', attrs: subject.attrs }, comps: comparables.map(toCompSummary) }),
  });
  const byId = new Map(out.decisions.map((d) => [d.compId, d]));
  const updated = comparables.map((c, i) => {
    const d = byId.get(c.id);
    if (!d) return c;
    return { ...c, selection: d.selection, adjustedValue: d.adjustedValue, adjustmentNarrative: d.adjustmentNarrative,
      adjustments: d.adjustments.map((a) => ({ dimension: a.dimension, deltaPct: a.delta, rationale: a.rationale,
        sourceRef: [{ provider: 'llm', endpoint: 'node:reasonAndSelect', fetchedAt: new Date().toISOString(), path: `/comparables/${i}/salePrice` }] })) };
  });
  return { comparables: updated };
}
```

`toCompSummary(c)` projects a `Comparable` to the prompt's comp shape (no photos/vision yet). The `comparables` merge-by-key reducer (`id`) merges the updated array back.

## 6. Graph wiring — `src/agents/graph.ts`

`START → resolveAddress → fetchCandidateComps → reasonAndSelect → END`. Add the node + edge.

## 7. Testing

- **`tests/unit/reasonAndSelect.test.ts`** (node): `vi.mock('@/tools/llm/structuredCall', () => ({ callWithFallback: vi.fn() }))` (avoids the model *and* the DB ledger write). Seed `graphState` with 2–3 candidate comps; mock `callWithFallback` to return decisions for some of them. Assert: matched comps get `selection`/`adjustedValue`/`adjustmentNarrative`/mapped `adjustments` (with `deltaPct` + a 1-element `sourceRef` of provider `'llm'`); an unmatched comp stays `candidate`; an LLM rejection (`mockRejectedValue`) makes the node reject; no-subject/no-comps → `PARTIAL_DATA` error with no LLM call.
- **`tests/unit/reasonAndSelect.prompt.test.ts`** (prompt, pure): `buildMessages` includes the subject suburb + every comp id; `version` is a non-empty string.
- **Update `tests/unit/graph.test.ts`**: add `vi.mock` of `callWithFallback` returning canned decisions; assert the run ends with comps carrying a non-`candidate` `selection`.

## 8. Out of scope

- Node 07 triangulate (consumes Node 06's adjusted comps), compose, critic, render.
- Vision over subject/comp photos (04a/b) — the prompt omits vision fields for now.
- Real model-id wiring / live LLM calls (tests mock the LLM; `OPENAI_MODEL_REASONING` must be set for production).
- Langfuse trace wiring on the call.

## 9. Definition of done

- `ReasonSelectAdjustmentSchema` simplified; `reasonAndSelect` prompt module + node implemented; wired `… → reasonAndSelect → END`.
- New unit tests + updated graph test; `pnpm typecheck && pnpm lint && pnpm test` all green.
- Changes limited to: `schemas/reasonSelect.ts`, `prompts/reasonAndSelect.ts`, `agents/nodes/06_reasonAndSelect.ts`, `agents/graph.ts`, and the three test files; `CLAUDE.md` untouched.
