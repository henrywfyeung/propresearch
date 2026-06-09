# Design: Node 07 `triangulate` (v2 comp-derived value range)

- **Date:** 2026-05-30
- **Status:** Design (autonomous; methodology flagged to owner; not billing-related)
- **Scope:** A deterministic node that reconciles the selected comps into a value range, replacing the Domain-shaped multi-signal `TriangulatedValueSchema`.

---

## 1. Context & methodology

§7.9 designed triangulation across **three** signals (Domain AVM + comp-derived + rental-implied) with LLM-chosen weights. In v2 there is **no AVM and no rental** (§0 — both were Domain). So valuation collapses to a **single signal: the comparables**. Node 07 therefore:

- Takes the comps the LLM marked `selection:'fair-value'` (Node 06), each carrying an `adjustedValue` (fallback: `salePrice` if null).
- Computes a **similarity-weighted mean** (`compDerived`), a **low/high range** (min/max of the adjusted values), and a **spread** = `(high − low) / median`.
- Applies the **§7.9 divergence guardrail across the comps**: `spread > 0.25` forces `confidence:'low'` + an `uncertaintyNote`.
- Is **deterministic — no LLM.** With one signal there are no weights to "reason" about (per-comp weights are just normalised similarity), so the value math is mechanical; the rich prose is Node 10 (compose). This is cheaper, fully unit-testable, and avoids an LLM call here.

## 2. Schema change — `src/schemas/state.ts`

Rewrite `TriangulatedValueSchema` to the v2 (comp-only) shape and rewrite `tests/unit/triangulation.test.ts` to match. (No node consumes it yet, so only those two files are affected.)

```ts
export const TriangulatedValueSchema = z
  .object({
    compDerived: z.number(),     // similarity-weighted mean of fair-value comps' adjustedValue
    low: z.number(),             // min adjusted value among the comps used
    high: z.number(),            // max adjusted value
    reconciled: z.number(),      // = compDerived in v2 (single signal)
    confidence: z.enum(['high', 'medium', 'low']),
    spread: z.number().min(0),   // (high - low) / median
    compIds: z.array(z.string()),// the comps this value is derived from (provenance)
    uncertaintyNote: z.string().nullable(), // required when spread > 0.25
    narrative: z.string().min(40),
  })
  .refine(
    (v) => v.spread <= 0.25 || (v.confidence === 'low' && v.uncertaintyNote !== null),
    'high spread (>0.25) requires confidence=low and an uncertaintyNote',
  );
```

Removed (Domain leftovers): `domainAvm`, `domainAvmConfidence`, `rentalImplied`, and the signal-`weights` record. Added: `low`, `high`, `compIds`.

## 3. Node — `src/agents/nodes/07_triangulate.ts`

Deterministic `(GraphState) => Partial<GraphState>`:

1. `selected = comparables.filter(c => c.selection === 'fair-value')`. If empty → in-band `PARTIAL_DATA` error (no value without selected comps).
2. For each: `value = c.adjustedValue ?? c.salePrice`, `weight = max(1, c.similarityScore)`.
3. `compDerived = round(Σ value·weight / Σ weight)`.
4. `sorted = values.sort()`; `low = sorted[0]`, `high = sorted[last]`, `median = sorted[mid]`; `spread = median > 0 ? (high - low) / median : 0`.
5. `confidence = spread <= 0.1 && selected.length >= 3 ? 'high' : spread <= 0.25 ? 'medium' : 'low'`.
6. `uncertaintyNote = spread > 0.25 ? '<templated note>' : null`.
7. `narrative = '<templated: N fair-value comps, weighted estimate $X, range $low–$high>'` (≥40 chars).
8. Return `{ triangulation: { compDerived, low, high, reconciled: compDerived, confidence, spread, compIds, uncertaintyNote, narrative } }`.

## 4. Graph wiring

- **`annotation.ts`:** add `triangulation: Annotation<TriangulatedValue | null>({ reducer: (_c, u) => u, default: () => null })`.
- **`graph.ts`:** `… → reasonAndSelect → triangulate → END`.

## 5. Testing — `tests/unit/triangulate.test.ts`

- **Tight cluster → high confidence:** 3+ fair-value comps with close adjusted values → `confidence:'high'`, `compDerived` ≈ weighted mean, `low`/`high` correct, `uncertaintyNote` null.
- **Wide spread → low confidence + note:** comps with adjusted values spanning >25% of the median → `confidence:'low'`, `uncertaintyNote` non-null, and the schema's refine accepts it.
- **Weighting:** a higher-`similarityScore` comp pulls `compDerived` toward its value (assert vs a plain mean).
- **No fair-value comps → `PARTIAL_DATA` error**, no `triangulation`.
- **Schema:** rewrite `triangulation.test.ts` — accepts a valid v2 object; rejects `spread:0.5` with `confidence:'high'`; accepts `spread:0.5` with `confidence:'low'` + note.
- **Update `graph.test.ts`:** after the LLM mock marks `NEAR` `fair-value`, assert the run ends with `state.triangulation?.reconciled` a positive number.

## 6. Out of scope

- LLM narrative (deterministic template for v2; compose does the prose).
- Rental/AVM signals (removed); a future rental node could re-add a second signal + re-weight.
- Node 10 compose / render.

## 7. Definition of done

- `TriangulatedValueSchema` rewritten (v2); `triangulate` node + `triangulation` channel; graph runs `… → triangulate → END`.
- `triangulate.test.ts` + rewritten `triangulation.test.ts` + updated `graph.test.ts`; `pnpm typecheck && pnpm lint && pnpm test` green.
- Changes limited to `schemas/state.ts`, `agents/{annotation,graph}.ts`, `agents/nodes/07_triangulate.ts`, and the three test files; `CLAUDE.md` untouched.
