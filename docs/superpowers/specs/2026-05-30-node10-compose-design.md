# Design: Node 10 `compose` (v0 — 4 core sections)

- **Date:** 2026-05-30
- **Status:** Design (autonomous; not billing-related)
- **Scope:** The compose node, producing `ReportProse` for the four sections we have data for: `summary`, `subject`, `valuation`, `comparables`. LLM writes narrative; the node stamps the one structured claim (the valuation range).

---

## 1. Context & decisions

§7.12 has compose emit `ClaimBlock[]` per section (one LLM call per section, parallel). v0 scope + robustness decisions:

- **Sections:** `summary`, `subject`, `valuation`, `comparables` only. `rentals`/`market`/`risks`/`planning`/`negotiation` need data nodes that don't exist yet — deferred.
- **LLM output is `text`-only.** Each section call returns an array of `{type:'text', text}` blocks (narrative). The LLM does **not** author `claim`/`range`/`comp-ref` blocks — those carry a `sourceRef` with an RFC-6901 `path`, and an LLM fabricating valid pointers is fragile (same reason Node 06 stamps its own refs).
- **The node stamps the structured claim.** It injects a deterministic `range` `ClaimBlock` (from `state.triangulation` low/high, with a real `sourceRef.path = '/triangulation/reconciled'`) into the `valuation` section. This is the single most important, critic-verifiable number; richer structured claims (comp-refs, per-attr) are a later compose increment.
- **Parallel + no LLM-down degrade.** The four section calls run concurrently; any `callWithFallback` rejection propagates (keystone; retryable). No `report_node_artifacts` idempotency here — that's an Inngest-resumption concern, not yet built.

## 2. Prose channel — `src/agents/annotation.ts`

Add a `prose` channel with a record-merge reducer (so partial section writes merge by section key):

```ts
prose: Annotation<ReportProse>({ reducer: (cur, inc) => ({ ...cur, ...inc }), default: () => ({}) }),
```

## 3. Prompt module — `src/prompts/compose.ts`

```ts
export const version = 'v1.0';
export type ComposeSection = 'summary' | 'subject' | 'valuation' | 'comparables';
export interface ComposeInput {
  suburb: string;
  subjectAttrs: { beds; baths; parking; landArea; buildingArea; propertyType };
  triangulation: { compDerived; low; high; reconciled; confidence; spread } | null;
  selectedComps: Array<{ id; address; salePrice; adjustedValue; contractDate; beds; baths; propertyType; selection }>;
}
export function buildMessages(section: ComposeSection, input: ComposeInput): LlmMessage[];
```

Voice (§7.12): direct, confident, specific; no marketing language; plain Australian English; prices in AUD. Each section's system message states what to cover (summary = the headline verdict + value range in words; subject = the property's attributes in prose; valuation = how the comps support the range + the confidence/uncertainty; comparables = a narrative walkthrough of the fair-value comps). User message carries the relevant slice as JSON. **Output: a JSON array of `{type:"text", text}` only.**

## 4. Node — `src/agents/nodes/10_compose.ts`

```ts
const SECTIONS: ComposeSection[] = ['summary', 'subject', 'valuation', 'comparables'];
const TextBlocksSchema = z.array(z.object({ type: z.literal('text'), text: z.string().min(1) }));

export async function compose(state: GraphState): Promise<Partial<GraphState>> {
  const { subject, resolvedAddress, comparables, triangulation } = state;
  if (!subject) return { errors: [{ code: 'PARTIAL_DATA', message: 'compose: no subject' }] };

  const input: ComposeInput = { suburb: resolvedAddress?.suburb ?? '', subjectAttrs: subject.attrs,
    triangulation, selectedComps: comparables.filter(c => c.selection === 'fair-value' || c.selection === 'negotiation-anchor').map(toCompSummary) };

  const blocks = await Promise.all(SECTIONS.map(async (section) => {
    const out = await callWithFallback({ model: env.OPENAI_MODEL_COMPOSE ?? '', schema: TextBlocksSchema,
      node: `compose:${section}`, promptVersion: version, messages: buildMessages(section, input) });
    return [section, out as ClaimBlock[]] as const;
  }));

  const prose: ReportProse = Object.fromEntries(blocks);
  // Stamp the deterministic valuation range claim.
  if (triangulation) {
    prose.valuation = [
      { type: 'range', text: 'Estimated value {{lo}}–{{hi}}', low: triangulation.low, high: triangulation.high,
        format: 'currency-aud', sourceRef: { provider: 'derived', endpoint: 'node:triangulate',
          fetchedAt: new Date().toISOString(), path: '/triangulation/reconciled' } },
      ...(prose.valuation ?? []),
    ];
  }
  return { prose };
}
```

`toCompSummary` projects a `Comparable` to the prompt's comp shape. The `text`-only `TextBlocksSchema` is a structural subset of `ClaimBlock`, so the cast is sound; the injected `range` block is a full `ClaimBlock`.

## 5. Graph wiring — `src/agents/graph.ts`

`… → triangulate → compose → END`.

## 6. Testing — `tests/unit/compose.test.ts` (+ prompt test)

- `vi.mock('@/tools/llm/structuredCall')`; `callWithFallback` resolves to `[{type:'text', text:'…'}]`. Seed `graphState` with a subject, a couple of fair-value comps, and a `triangulation`. Assert: `prose` has all four section keys; each is a non-empty `ClaimBlock[]`; the `valuation` section's **first** block is the `range` block with `low`/`high` from `triangulation` and `sourceRef.path === '/triangulation/reconciled'`; `callWithFallback` was called 4× (once per section).
- No-subject → `PARTIAL_DATA`, no LLM call.
- LLM rejection → node rejects.
- `compose.prompt.test.ts`: `buildMessages('valuation', input)` returns system+user, user contains the suburb; `version` non-empty.
- Update `graph.test.ts`: the LLM mock already returns reasonAndSelect decisions — make `callWithFallback` return decisions for the reasonAndSelect call and text blocks for compose (it's mocked globally; return a value valid for both — a `ReasonSelectOutput`-shaped object won't parse as text blocks). **Simpler:** in `graph.test.ts`, mock `callWithFallback` with `mockImplementation` keyed on `opts.node` (returns `ReasonSelectOutput` when `node==='reasonAndSelect'`, text blocks when `node` starts with `compose:`). Assert the run ends with `state.prose.valuation` defined.

## 7. Out of scope

- The other 5 sections + their data nodes (risks/market/planning/rentals/negotiation).
- LLM-authored structured claims / comp-refs (v0 stamps only the valuation range).
- The critic (Node 11), revise, render (Node 13), idempotency artifacts.

## 8. Definition of done

- `prose` channel; `compose` prompt module + node (4 parallel sections, text blocks + stamped valuation range); graph runs `… → compose → END`.
- New unit tests + node-keyed graph-test mock; `pnpm typecheck && pnpm lint && pnpm test` green.
- Changes limited to `agents/{annotation,graph}.ts`, `agents/nodes/10_compose.ts`, `prompts/compose.ts`, and the test files; `CLAUDE.md` untouched.
