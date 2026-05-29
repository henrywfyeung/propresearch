// Graph state helpers — the two halves of the mid-node durability mechanism
// (CLAUDE.md §6.1 / §6.3).
//
// `mergeByKey` ([R20]) is the reducer used for `comparables`, `risks`, and
// `prose`. It deep-merges incoming partial entries into existing ones keyed
// on a field, preserving entries not present in the incoming batch — so a
// node that re-emits only the items it just processed never wipes items a
// prior (crashed) run completed.
//
// `resolvePointer` ([R22]) resolves an RFC 6901 JSON Pointer against the
// state object for the deterministic critic (§7.13 Pass 1).

import { PointerUnresolvedError } from '@/lib/errors';

/**
 * Build a LangGraph reducer that merges incoming items into existing ones by
 * a key field (per-field last-write-wins), preserving untouched entries.
 */
export function mergeByKey<T extends Record<string, unknown>>(keyField: keyof T) {
  return (current: T[] | undefined, incoming: T[] | undefined): T[] => {
    const byKey = new Map<unknown, T>();
    for (const item of current ?? []) {
      byKey.set(item[keyField], item);
    }
    for (const item of incoming ?? []) {
      const k = item[keyField];
      const existing = byKey.get(k);
      // Deep-ish merge: shallow spread is enough for our flat-ish entries,
      // but null/undefined incoming fields must not clobber existing values.
      if (existing) {
        const merged = { ...existing };
        for (const [field, value] of Object.entries(item)) {
          if (value !== undefined && value !== null) {
            (merged as Record<string, unknown>)[field] = value;
          }
        }
        byKey.set(k, merged);
      } else {
        byKey.set(k, item);
      }
    }
    return Array.from(byKey.values());
  };
}

/** Append reducer for `errors` / `llmCalls`. */
export function appendReducer<T>(current: T[] | undefined, incoming: T[] | undefined): T[] {
  return [...(current ?? []), ...(incoming ?? [])];
}

/** Replacement reducer for `criticFindings` (each pass replaces the set). */
export function replaceReducer<T>(_current: T | undefined, incoming: T): T {
  return incoming;
}

// --------------------------------------------------------------------------
// JSON Pointer (RFC 6901) resolution for the deterministic critic [R22]
// --------------------------------------------------------------------------

/** Decode a single RFC 6901 reference token (~1 → /, ~0 → ~). */
function decodeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Resolve a JSON Pointer against `root`. Throws PointerUnresolvedError if the
 * pointer doesn't land on a value. Empty string ("") resolves to the root.
 */
export function resolvePointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  if (!pointer.startsWith('/')) {
    throw new PointerUnresolvedError(pointer, { reason: 'must start with /' });
  }
  const tokens = pointer.slice(1).split('/').map(decodeToken);
  let cursor: unknown = root;
  for (const token of tokens) {
    if (cursor == null || typeof cursor !== 'object') {
      throw new PointerUnresolvedError(pointer, { failedAt: token });
    }
    if (Array.isArray(cursor)) {
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) {
        throw new PointerUnresolvedError(pointer, { failedAt: token, kind: 'array-index' });
      }
      cursor = cursor[idx];
    } else {
      const obj = cursor as Record<string, unknown>;
      if (!(token in obj)) {
        throw new PointerUnresolvedError(pointer, { failedAt: token, kind: 'missing-key' });
      }
      cursor = obj[token];
    }
  }
  return cursor;
}

/** Non-throwing variant — returns undefined instead of throwing. */
export function tryResolvePointer(root: unknown, pointer: string): unknown {
  try {
    return resolvePointer(root, pointer);
  } catch {
    return undefined;
  }
}
