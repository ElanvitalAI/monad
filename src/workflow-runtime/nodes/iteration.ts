// Node-catalog N1.3 (2026-05-11) — sequential iteration executor (v1).
//
// Resolves `items` through the standard variable surface to a JSON
// array (preferred) or newline-split list (fallback for `$bash.output`
// captures). For each element runs the `body` bash snippet with two
// extra substitutions on top:
//
//   $item   → JSON-stringified value when non-string, raw otherwise
//   $index  → zero-based index
//
// The node fails fast on the first iteration that errors so authors
// see the failure without scrolling through subsequent runs.
//
// Sub-DAG iteration (full nested workflow per element) is a v2
// follow-up. v1 keeps the executor footprint small and bash-only.

import type {
  IterationNode,
  NodeExecContext,
  NodeOutput,
  WorkflowDeps,
} from '../types.js';
import { interpolate } from '../variables.js';

/** Pure: turn the resolved `items` text into an array. JSON parse
 *  wins (handles JSON arrays + `output_format`-emitted arrays);
 *  newline-split is the bash-stdout fallback. Empty text → [].
 *  Exposed for unit tests. */
export function resolveIterationItems(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  return trimmed.split('\n').filter((l) => l.length > 0);
}

/** Pure: substitute `$item` and `$index` into the body. Done before
 *  the standard interpolate pass so authors can still reference other
 *  node outputs in the same body (e.g. `echo $item via $detect.output`).
 *  Exposed for unit tests. */
export function applyIterationVars(body: string, item: unknown, index: number): string {
  const itemStr =
    typeof item === 'string' ? item
      : item === null || item === undefined ? ''
        : typeof item === 'number' || typeof item === 'boolean' ? String(item)
          : JSON.stringify(item);
  return body
    .replace(/\$index\b/g, String(index))
    .replace(/\$item\b/g, itemStr);
}

export async function executeIterationNode(
  node: IterationNode,
  ctx: NodeExecContext,
  deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  const interp = interpolate(node.iteration.items, {
    arguments: ctx.arguments,
    artifactsDir: ctx.artifactsDir,
    outputs: ctx.outputs,
  });
  const items = resolveIterationItems(interp.text);
  if (items.length === 0) {
    return {
      ok: true,
      output: [],
      durationMs: Date.now() - startedAt,
    };
  }

  const collected: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const withVars = applyIterationVars(node.iteration.body, items[i], i);
    const { text: bodyText } = interpolate(withVars, {
      arguments: ctx.arguments,
      artifactsDir: ctx.artifactsDir,
      outputs: ctx.outputs,
    });
    let r;
    try {
      r = await deps.runBash(bodyText, {
        timeoutMs: node.idle_timeout,
        signal: ctx.signal,
        cwd: process.cwd(),
      });
    } catch (err) {
      return {
        ok: false,
        output: collected,
        error: `iteration[${i}] failed: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startedAt,
      };
    }
    if (r.exitCode !== 0) {
      return {
        ok: false,
        output: collected,
        error: `iteration[${i}] exit ${r.exitCode}${r.stderr ? `: ${r.stderr.slice(0, 500)}` : ''}`,
        durationMs: Date.now() - startedAt,
      };
    }
    collected.push(r.stdout);
  }
  return {
    ok: true,
    output: collected,
    durationMs: Date.now() - startedAt,
  };
}
