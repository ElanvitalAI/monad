// Archon-port T2.1 (2026-05-08) — variable interpolation.
//
// Patterns supported (Archon `archon-workflow-builder.yaml:166`):
//   $ARGUMENTS                 → user-provided args string
//   $ARTIFACTS_DIR             → run-scoped artifacts dir
//   $<nodeId>.output           → previous node's raw output (string)
//   $<nodeId>.output.<field>   → JSON field access (when output_format
//                                produced a parsed object)
//
// Resolution rules:
//   - kebab-case node ids (matches schema KEBAB_RE)
//   - field path supports dotted access (`.foo.bar.baz`)
//   - missing references → empty string + a soft warning logged via
//     console.warn (so tests can grep for them; production callers
//     can override)
//   - escape: `\$X` (backslash) emits literal `$X` (no expansion)
//
// We intentionally do NOT shell-quote — Archon convention. Each node
// type decides how to use the result (bash heredoc, prompt body, etc).

import type { NodeOutput } from './types.js';

// Order matters: the longest-prefixed pattern must match first so
// `$arg.output.field` is not consumed by `$arg.output`. Matched
// against the full source via single-pass replace + group capture.
const VARIABLE_RE = /\\\$|\$ARGUMENTS\b|\$ARTIFACTS_DIR\b|\$([a-z0-9]+(?:-[a-z0-9]+)*)\.output(?:\.([A-Za-z_][A-Za-z0-9_.]*))?/g;

export interface InterpolateContext {
  arguments: string;
  artifactsDir: string;
  outputs: Record<string, NodeOutput>;
  /** Node-catalog N3.2 (2026-05-11) — optional per-iteration variables
   *  surfaced when `evaluateWhen` is called from inside a filter (or
   *  future per-element evaluator). When supplied, `$item == 'x'` and
   *  `$index == N` patterns become valid in the condition. */
  item?: unknown;
  index?: number;
}

export interface InterpolateResult {
  text: string;
  /** Names of references that resolved to empty (missing dep, no output_format
   *  field, etc.). Caller may turn these into warnings or strict errors. */
  missing: string[];
}

export function interpolate(text: string, ctx: InterpolateContext): InterpolateResult {
  if (!text) return { text, missing: [] };
  const missing: string[] = [];
  const replaced = text.replace(VARIABLE_RE, (match, nodeId?: string, fieldPath?: string) => {
    // Escaped: emit literal `$X` (drop the backslash)
    if (match.startsWith('\\$')) return match.slice(1);
    if (match === '$ARGUMENTS') return ctx.arguments;
    if (match === '$ARTIFACTS_DIR') return ctx.artifactsDir;
    if (typeof nodeId === 'string') {
      const out = ctx.outputs[nodeId];
      if (!out) {
        missing.push(`$${nodeId}.output${fieldPath ? `.${fieldPath}` : ''}`);
        return '';
      }
      if (!fieldPath) {
        return stringifyOutput(out.output);
      }
      const v = readPath(out.output, fieldPath);
      if (v === undefined) {
        missing.push(`$${nodeId}.output.${fieldPath}`);
        return '';
      }
      return stringifyOutput(v);
    }
    return match;
  });
  return { text: replaced, missing };
}

function stringifyOutput(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function readPath(obj: unknown, path: string): unknown {
  if (typeof obj !== 'object' || obj === null) return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Evaluate a `when` expression. Currently supports a small subset:
 *   - `$<id>.output == 'value'`
 *   - `$<id>.output != 'value'`
 *   - `$<id>.output.field == 'value'`
 *   - `$<id>.ok == true|false`
 *   - bare truthy: just `$<id>.output` (truthy if non-empty string)
 *
 * Anything more complex falls through to `true` with a warning — the
 * MVP is intentionally narrow so authors can't write arbitrary JS in
 * a YAML. This mirrors Archon's simple condition-evaluator surface
 * (packages/workflows/src/condition-evaluator.ts ~120 LOC) without
 * the full expression grammar. */
export function evaluateWhen(expr: string, ctx: InterpolateContext): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return true;

  // ok-check
  const okMatch = /^\$([a-z0-9]+(?:-[a-z0-9]+)*)\.ok\s*==\s*(true|false)$/.exec(trimmed);
  if (okMatch) {
    const out = ctx.outputs[okMatch[1]];
    if (!out) return false;
    return out.ok === (okMatch[2] === 'true');
  }

  // Node-catalog N1.1 (2026-05-11) — `$ARGUMENTS == 'value'` / `!=`. The
  // run-level $ARGUMENTS is the most-common branch driver for if/switch
  // nodes, so authoring `if: { condition: "$ARGUMENTS == 'yes'" }` works
  // out of the box without an upstream output node.
  const argsEqMatch = /^\$ARGUMENTS\s*(==|!=)\s*['"](.*)['"]$/.exec(trimmed);
  if (argsEqMatch) {
    const [, op, expected] = argsEqMatch;
    return op === '==' ? ctx.arguments === expected : ctx.arguments !== expected;
  }

  // Node-catalog N3.2 (2026-05-11) — `$item == 'value'` and
  // `$item.field == 'value'` patterns. Active only when the caller
  // supplied `ctx.item` (i.e. invoked from inside Filter or another
  // per-element evaluator). Falls through to the unsupported-warning
  // path otherwise so a stray `$item` outside a filter still surfaces
  // as a warning rather than silently matching.
  if (ctx.item !== undefined) {
    const itemEq = /^\$item\s*(==|!=)\s*['"](.*)['"]$/.exec(trimmed);
    if (itemEq) {
      const [, op, expected] = itemEq;
      const actual = stringifyOutput(ctx.item);
      return op === '==' ? actual === expected : actual !== expected;
    }
    const itemFieldEq = /^\$item\.([A-Za-z_][A-Za-z0-9_.]*)\s*(==|!=)\s*['"](.*)['"]$/.exec(trimmed);
    if (itemFieldEq) {
      const [, fieldPath, op, expected] = itemFieldEq;
      const v = readPath(ctx.item, fieldPath);
      const actual = stringifyOutput(v);
      return op === '==' ? actual === expected : actual !== expected;
    }
    if (trimmed === '$item') {
      const v = ctx.item;
      if (v === undefined || v === null) return false;
      if (typeof v === 'string') return v.length > 0;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      return true;
    }
  }
  if (typeof ctx.index === 'number') {
    const indexEq = /^\$index\s*(==|!=)\s*(\d+)$/.exec(trimmed);
    if (indexEq) {
      const [, op, n] = indexEq;
      const expected = parseInt(n, 10);
      return op === '==' ? ctx.index === expected : ctx.index !== expected;
    }
  }

  // <ref> == 'value' or != 'value'
  const eqMatch = /^\$([a-z0-9]+(?:-[a-z0-9]+)*)\.output(?:\.([A-Za-z_][A-Za-z0-9_.]*))?\s*(==|!=)\s*['"](.*)['"]$/.exec(trimmed);
  if (eqMatch) {
    const [, nodeId, fieldPath, op, expected] = eqMatch;
    const out = ctx.outputs[nodeId];
    if (!out) return op === '!=';
    const actual = fieldPath ? readPath(out.output, fieldPath) : out.output;
    const actualStr = stringifyOutput(actual);
    return op === '==' ? actualStr === expected : actualStr !== expected;
  }

  // Bare truthy: $ARGUMENTS
  if (trimmed === '$ARGUMENTS') {
    return ctx.arguments.length > 0;
  }

  // Bare truthy: $<id>.output
  const truthyMatch = /^\$([a-z0-9]+(?:-[a-z0-9]+)*)\.output(?:\.([A-Za-z_][A-Za-z0-9_.]*))?$/.exec(trimmed);
  if (truthyMatch) {
    const [, nodeId, fieldPath] = truthyMatch;
    const out = ctx.outputs[nodeId];
    if (!out) return false;
    const v = fieldPath ? readPath(out.output, fieldPath) : out.output;
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') return v.length > 0;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return true;
  }

  // Unsupported expression — be permissive (Archon parity); caller
  // can grep the warning log to decide if it's a real issue.
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`workflow.when: unsupported expression '${trimmed}' — defaulting to true`);
  }
  return true;
}
