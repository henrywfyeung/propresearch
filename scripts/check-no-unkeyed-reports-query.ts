/**
 * Enforces CLAUDE.md §4.3 / [R3] / [R26]: no Drizzle query against `reports`
 * may touch `reports.state` without also constraining by `reports.id`.
 * Cross-row JSONB queries against listing-derived data are the exact pattern
 * Domain's TOS guidance forbids; this script is the primary enforcement.
 *
 * Allowed:
 *   db.select().from(reports).where(eq(reports.id, x))            // any column OK
 *   db.select({status: reports.status}).from(reports)             // top-level only, no `state`
 *
 * Forbidden:
 *   db.select({...reports.state}).from(reports)                   // touches state, no id
 *   db.select().from(reports).where(ilike(reports.subjectAddress, q)) // OK — denormalised top-level
 *
 * Implemented as a small TS-AST walk rather than an ESLint plugin so we
 * don't have to maintain a second linter (Biome handles everything else).
 *
 * Exit code 0 = clean; 1 = violation found; 2 = script error.
 */
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(import.meta.dirname, '..', 'src');

function findFiles(dir: string): string[] {
  // Node 22+ globSync is sync-iterable; keep it simple.
  return Array.from(
    globSync('**/*.{ts,tsx}', { cwd: dir }) as Iterable<string>,
  ).map((rel) => resolve(dir, rel));
}

interface Violation {
  file: string;
  line: number;
  col: number;
  reason: string;
}

const violations: Violation[] = [];

function record(file: string, node: ts.Node, sf: ts.SourceFile, reason: string): void {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  violations.push({ file, line: line + 1, col: character + 1, reason });
}

/**
 * Walks a CallExpression chain that ends in `.from(reports)` and returns
 * (touchesState, hasIdPredicate) for the whole chain.
 */
function analyseChain(
  call: ts.CallExpression,
  sf: ts.SourceFile,
): { touchesState: boolean; hasIdPredicate: boolean } {
  let touchesState = false;
  let hasIdPredicate = false;

  // Collect every PropertyAccessExpression `reports.X` in the chain's text.
  // Crude but cheap: scan the chain's text once.
  const text = call.getText(sf);
  if (/\breports\.state\b/.test(text)) touchesState = true;
  if (/\beq\(\s*reports\.id\b/.test(text)) hasIdPredicate = true;

  return { touchesState, hasIdPredicate };
}

/**
 * Detect `<chain>.from(reports)` calls.
 */
function visit(node: ts.Node, sf: ts.SourceFile, file: string): void {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === 'from' &&
      node.arguments.length === 1 &&
      ts.isIdentifier(node.arguments[0]!) &&
      node.arguments[0]!.text === 'reports'
    ) {
      // Walk up to the outermost call so we capture .where() in the same chain.
      let outer: ts.Node = node;
      while (
        outer.parent &&
        (ts.isPropertyAccessExpression(outer.parent) || ts.isCallExpression(outer.parent))
      ) {
        outer = outer.parent;
      }
      // outer might be a CallExpression (with .where chained) or just the .from().
      const chainCall = ts.isCallExpression(outer) ? outer : node;
      const { touchesState, hasIdPredicate } = analyseChain(chainCall, sf);
      if (touchesState && !hasIdPredicate) {
        record(
          file,
          node,
          sf,
          'query against reports touches `reports.state` without an `eq(reports.id, …)` predicate — CLAUDE.md §4.3 / R3',
        );
      }
    }
  }
  ts.forEachChild(node, (c) => visit(c, sf, file));
}

const files = findFiles(ROOT).filter((f) => !f.includes('/migrations/'));

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // Cheap pre-filter: skip files that don't even mention `from(reports)`.
  if (!src.includes('from(reports)')) continue;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true);
  visit(sf, sf, file);
}

if (violations.length === 0) {
  console.log('✓ no-unkeyed-reports-query: clean');
  process.exit(0);
}

console.error('✗ no-unkeyed-reports-query: violations found');
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}:${v.col} — ${v.reason}`);
}
process.exit(1);
