# Design: graph framework + Node 03 wired

- **Date:** 2026-05-30
- **Status:** Draft for review
- **Scope:** The LangGraph engine skeleton + `fetchCandidateComps` (Node 03) as the first real node
- **Builds on:** `selectComparables` (shipped, `src/tools/comps/selectComparables.ts`)

---

## 1. Context

The comp engine is a tested tool chain (`selectComparables`). This increment stands up the **LangGraph runtime** so that logic runs as a graph node, producing the first runnable slice: seeded `{resolvedAddress, subject}` → `comparables` in graph state.

Deliberately minimal (owner decision):
- **Minimal `Annotation.Root`** — only the channels Node 03 touches; grow per node.
- **No checkpointer / no Inngest** this increment — compile in-memory. `PostgresSaver` resumption (§6.3) lands with the Inngest workflow.
- **Subject + resolvedAddress are graph inputs** — Nodes 01 (resolveAddress) / 02 (subject) are deferred.

## 2. Architecture & files

| File | Responsibility | Action |
|---|---|---|
| `src/agents/annotation.ts` | `GraphAnnotation` (`Annotation.Root`) + `GraphState` type | Create |
| `src/agents/graph.ts` | `StateGraph` wiring, compiled graph, `runGraph()` | Create |
| `src/agents/nodes/03_fetchCandidateComps.ts` | Node 03 node function | Create |
| `src/agents/state.ts` | loosen `mergeByKey` generic (see §3) | Modify |
| `tests/unit/graph.test.ts` | end-to-end graph invoke (MSW for REA) | Create |

Reuses `mergeByKey` / `appendReducer` (`src/agents/state.ts`), `selectComparables` (`src/tools/comps/`), `runWithReportContext` (`src/agents/reportContext.ts`), and the `ResolvedAddress`/`SubjectProperty`/`Comparable` types (`src/schemas/state.ts`).

## 3. State — `annotation.ts`

```ts
import { Annotation } from '@langchain/langgraph';
import { appendReducer, mergeByKey } from '@/agents/state';
import type { Comparable, ResolvedAddress, SubjectProperty } from '@/schemas/state';

export const GraphAnnotation = Annotation.Root({
  reportId: Annotation<string>(),
  resolvedAddress: Annotation<ResolvedAddress | null>({ reducer: (_c, u) => u, default: () => null }),
  subject: Annotation<SubjectProperty | null>({ reducer: (_c, u) => u, default: () => null }),
  comparables: Annotation<Comparable[]>({ reducer: mergeByKey<Comparable>('id'), default: () => [] }),
  errors: Annotation<{ code: string; message: string }[]>({ reducer: appendReducer, default: () => [] }),
});

export type GraphState = typeof GraphAnnotation.State;
```

**`mergeByKey` constraint fix.** It is currently `mergeByKey<T extends Record<string, unknown>>`. Zod-inferred object types (`Comparable`) have no index signature, so that constraint rejects them at `mergeByKey<Comparable>('id')`. Loosen to `mergeByKey<T>(keyField: keyof T)` and use internal casts (`as Record<string, unknown>`) where it spreads/merges. Behaviour is unchanged; `tests/unit/state-helpers.test.ts` must still pass.

## 4. Node 03 — `nodes/03_fetchCandidateComps.ts`

```ts
import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import { selectComparables } from '@/tools/comps/selectComparables';

export async function fetchCandidateComps(state: GraphState): Promise<Partial<GraphState>> {
  const { resolvedAddress, subject } = state;
  if (!resolvedAddress || !subject) {
    return {
      errors: [{ code: 'PARTIAL_DATA', message: 'fetchCandidateComps: missing resolvedAddress or subject' }],
    };
  }
  try {
    const comparables = await selectComparables({
      subject: {
        beds: subject.attrs.beds,
        baths: subject.attrs.baths,
        landArea: subject.attrs.landArea,
        propertyType: subject.attrs.propertyType,
      },
      geo: { lat: resolvedAddress.lat, lng: resolvedAddress.lng },
      location: {
        suburb: resolvedAddress.suburb,
        state: resolvedAddress.state,
        postcode: resolvedAddress.postcode,
      },
    });
    return { comparables };
  } catch (err) {
    logger.warn({ err }, 'fetchCandidateComps: REA comp fetch failed; degrading to empty pool');
    return {
      comparables: [],
      errors: [{ code: 'PARTIAL_DATA', message: `fetchCandidateComps: ${(err as Error).message}` }],
    };
  }
}
```

The node returns only the channels it updates; `mergeByKey`/`appendReducer` merge them into state. It never throws — degradation (§7.17) is in-band via `errors`.

## 5. Graph — `graph.ts`

```ts
import { END, START, StateGraph } from '@langchain/langgraph';
import { GraphAnnotation, type GraphState } from '@/agents/annotation';
import { fetchCandidateComps } from '@/agents/nodes/03_fetchCandidateComps';
import { runWithReportContext } from '@/agents/reportContext';

export const reportGraph = new StateGraph(GraphAnnotation)
  .addNode('fetchCandidateComps', fetchCandidateComps)
  .addEdge(START, 'fetchCandidateComps')
  .addEdge('fetchCandidateComps', END)
  .compile();

/** Run the graph with a per-report context so the RapidAPI quota counts. */
export async function runGraph(input: Partial<GraphState>): Promise<GraphState> {
  const reportId = input.reportId ?? 'adhoc';
  return runWithReportContext({ reportId }, () => reportGraph.invoke(input));
}
```

Compiled with no checkpointer (in-memory). `runGraph` establishes the `reportContext` so `rapidApiCall`'s per-report quota is enforced inside the node.

## 6. Error / degradation

- Node 03 never throws; missing inputs or a failed REA fetch produce an in-band `PARTIAL_DATA` error + (for the fetch case) an empty `comparables`. The graph completes.
- The future graph (with downstream nodes) treats `errors` per §7.17. Here we just accumulate them via `appendReducer`.

## 7. Testing — `graph.test.ts`

MSW intercepts the REA `/auto-complete` + `/properties/search` calls; fake `Date` pinned (as in the `selectComparables` tests) for deterministic recency/180-day windows.

- **Happy path:** seed `{reportId, resolvedAddress, subject}`, mock REA with 2–3 sold listings → `runGraph` → assert `state.comparables` non-empty, ranked (highest `similarityScore` first), `selection==='candidate'`, and `state.errors` empty.
- **Degrade — REA down:** REA `/properties/search` returns 500 (all retries) → `state.comparables === []` and `state.errors` contains a `PARTIAL_DATA` entry.
- **Degrade — missing subject:** seed without `subject` → node returns the `PARTIAL_DATA` error, `comparables` stays `[]`.

> The merge-by-key reducer's accumulation semantics are already covered by `tests/unit/state-helpers.test.ts`. A single-node, single-invoke graph can't distinguish merge-by-key from last-value (both merge the node's array into the empty default), so we don't add a misleading graph-level assertion for it; the happy path confirms comps flow through the `comparables` channel.

## 8. Out of scope (next increments)

- Nodes 01 (resolveAddress) / 02 (human-supplied subject) — provided as inputs here.
- NSW VG reconciliation (`rea+nsw-vg`).
- `PostgresSaver` checkpointer + the Inngest workflow + step resumption.
- All downstream nodes (04–13) and the report render.

## 9. Definition of done

- `GraphAnnotation` (5 channels), `fetchCandidateComps`, and `reportGraph`/`runGraph` implemented per §3–§5.
- `mergeByKey` loosened; `tests/unit/state-helpers.test.ts` still green.
- `tests/unit/graph.test.ts` covers §7; `pnpm typecheck && pnpm lint && pnpm test` all green.
- Changes limited to the five files in §2; `CLAUDE.md` untouched.
