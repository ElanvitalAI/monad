// ── Presentation P3 · encodeWidgetTree (DeclarativeWidgetNode[] → JSON) ──
//
// Reverse of `decodeWidgetTree`. Produces a declarative tree suitable
// for `toJSON` round-trip + persistence (user config files · LLM
// scratchpads). Output shape always wraps in `{ layout: [...] }` for
// parser-agnostic consumption.

import { buildWidgetSpec, type DeclarativeWidgetNode } from './builder.js';
import { encodeWidgetStyleSpec, type WidgetSpec } from './spec.js';

export interface EncodedNode {
  readonly widget: string;
  readonly id?: string;
  readonly character?: string;
  readonly config?: Record<string, unknown>;
  readonly style?: Record<string, unknown>;
  readonly chrome?: Record<string, unknown>;
  readonly motion?: Record<string, unknown>;
  readonly interactions?: Record<string, unknown>;
  readonly children?: readonly EncodedNode[];
}

export interface EncodedTree {
  readonly layout: readonly EncodedNode[];
}

function encodeNode(spec: WidgetSpec): EncodedNode {
  const style = encodeWidgetStyleSpec(
    spec.style ?? (spec.decoration ? { decoration: spec.decoration } : undefined),
  );
  const out: EncodedNode = {
    widget: spec.type,
    ...(spec.id ? { id: spec.id } : {}),
    ...(spec.character ? { character: spec.character } : {}),
    ...(spec.config ? { config: spec.config } : {}),
    ...(style ? { style } : {}),
    ...(spec.chrome ? { chrome: spec.chrome as unknown as Record<string, unknown> } : {}),
    ...(spec.motion ? { motion: spec.motion as unknown as Record<string, unknown> } : {}),
    ...(spec.interactions ? { interactions: spec.interactions as unknown as Record<string, unknown> } : {}),
    ...(spec.children && spec.children.length > 0
      ? { children: spec.children.map(encodeNode) }
      : {}),
  };
  return out;
}

/** Encode a flat list of declarative widget nodes into a tree. The
 *  `layout` wrapper keeps the shape stable (array wrapper would be
 *  legal too but `layout` matches the canonical input shape). */
export function encodeWidgetTree(widgets: readonly DeclarativeWidgetNode[]): EncodedTree {
  return { layout: widgets.map((widget) => encodeNode(buildWidgetSpec(widget))) };
}

/** Encode + YAML serialize. Uses the project's `yaml` dependency. */
export async function encodeWidgetTreeYAML(widgets: readonly DeclarativeWidgetNode[]): Promise<string> {
  const tree = encodeWidgetTree(widgets);
  const mod = await import('yaml');
  const stringify =
    mod.stringify ?? (mod as unknown as { default: { stringify(v: unknown): string } }).default?.stringify;
  return stringify(tree);
}
