import { buildWidgetSpec, type DeclarativeWidgetNode } from './builder.js';
import type { WidgetSpec } from './spec.js';

export interface DeclarativeWidgetSpawnMeta {
  readonly declarativeSpec: WidgetSpec;
  readonly parentId?: string;
}

export interface DeclarativeWidgetHostLike {
  spawn(opts: {
    type: string;
    id?: string;
    character?: string;
    config?: Record<string, unknown>;
    meta?: DeclarativeWidgetSpawnMeta;
  }): { id: string };
}

export interface MaterializedWidgetRecord {
  readonly widgetId: string;
  readonly type: string;
  readonly parentId?: string;
  readonly spec: WidgetSpec;
}

export function widgetSpawnInputFromSpec(node: DeclarativeWidgetNode): {
  type: string;
  id?: string;
  character?: string;
  config?: Record<string, unknown>;
  meta: DeclarativeWidgetSpawnMeta;
} {
  const spec = buildWidgetSpec(node);
  return {
    type: spec.type,
    ...(spec.id ? { id: spec.id } : {}),
    ...(spec.character ?? spec.chrome?.title
      ? { character: spec.character ?? spec.chrome?.title }
      : {}),
    ...(spec.config ? { config: spec.config } : {}),
    meta: {
      declarativeSpec: spec,
    },
  };
}

function materializeNode(
  host: DeclarativeWidgetHostLike,
  node: DeclarativeWidgetNode,
  parentId: string | undefined,
  out: MaterializedWidgetRecord[],
): void {
  const spec = buildWidgetSpec(node);
  const spawned = host.spawn({
    ...widgetSpawnInputFromSpec(spec),
    meta: {
      declarativeSpec: spec,
      ...(parentId ? { parentId } : {}),
    },
  });
  out.push({
    widgetId: spawned.id,
    type: spec.type,
    ...(parentId ? { parentId } : {}),
    spec,
  });
  for (const child of spec.children ?? []) {
    materializeNode(host, child, spawned.id, out);
  }
}

export function materializeWidgetSpecs(
  host: DeclarativeWidgetHostLike,
  widgets: readonly DeclarativeWidgetNode[],
): readonly MaterializedWidgetRecord[] {
  const out: MaterializedWidgetRecord[] = [];
  for (const widget of widgets) {
    materializeNode(host, widget, undefined, out);
  }
  return out;
}
