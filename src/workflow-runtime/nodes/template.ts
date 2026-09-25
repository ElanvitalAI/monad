// Node-catalog N3.3 (2026-05-11) — Handlebars-lite template transform.
//
// Self-rolled `{{ path }}` substitution to avoid a dep on Handlebars
// or Mustache. Supported `path` forms (whitespace inside `{{ ... }}`
// is trimmed):
//
//   {{ARGUMENTS}}            → run args
//   {{ARTIFACTS_DIR}}        → artifacts dir
//   {{<id>.output}}          → upstream node output (stringified)
//   {{<id>.output.field}}    → JSON field access
//
// Anything else inside `{{...}}` resolves to empty string + the
// reference is added to the `missing` list (mirrors the
// `interpolate()` API). The `$X.output` syntax used elsewhere in
// the runtime is NOT accepted here on purpose — template authors
// want a different visual marker from interpolation expressions, and
// reserving `$X` for the runtime side keeps the two surfaces
// distinct.

import type {
  NodeExecContext,
  NodeOutput,
  TemplateNode,
  WorkflowDeps,
} from '../types.js';

const TEMPLATE_TAG_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const NODE_REF_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.output(?:\.([A-Za-z_][A-Za-z0-9_.]*))?$/;

function stringifyValue(v: unknown): string {
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

export interface RenderTemplateResult {
  text: string;
  missing: string[];
}

/** Pure: replace every `{{ path }}` in the template with the resolved
 *  value. Unknown references resolve to empty string + are surfaced
 *  via the returned `missing` list. Exposed for unit tests. */
export function renderTemplate(
  template: string,
  ctx: {
    arguments: string;
    artifactsDir: string;
    outputs: Record<string, { output: unknown }>;
  },
): RenderTemplateResult {
  const missing: string[] = [];
  const text = template.replace(TEMPLATE_TAG_RE, (_match, raw: string) => {
    const ref = raw.trim();
    if (ref === 'ARGUMENTS') return ctx.arguments;
    if (ref === 'ARTIFACTS_DIR') return ctx.artifactsDir;
    const m = NODE_REF_RE.exec(ref);
    if (m) {
      const nodeId = m[1];
      const fieldPath = m[2];
      const out = ctx.outputs[nodeId];
      if (!out) {
        missing.push(ref);
        return '';
      }
      if (!fieldPath) return stringifyValue(out.output);
      const v = readPath(out.output, fieldPath);
      if (v === undefined) {
        missing.push(ref);
        return '';
      }
      return stringifyValue(v);
    }
    missing.push(ref);
    return '';
  });
  return { text, missing };
}

export async function executeTemplateNode(
  node: TemplateNode,
  ctx: NodeExecContext,
  _deps: WorkflowDeps,
): Promise<NodeOutput> {
  const startedAt = Date.now();
  const { text } = renderTemplate(node.template.template, {
    arguments: ctx.arguments,
    artifactsDir: ctx.artifactsDir,
    outputs: ctx.outputs,
  });
  return {
    ok: true,
    output: text,
    durationMs: Date.now() - startedAt,
  };
}
