import type { View } from '../view.js';
import { buildWidgetSpec, type DeclarativeWidgetNode } from './builder.js';
import type { WidgetSpec } from './spec.js';
import {
  createDeclarativeView,
  hasDeclarativeViewFactory,
  type DeclarativeViewRuntimeDeps,
} from './view-runtime.js';
import { widgetSpawnInputFromSpec } from './materialize.js';

export type DeclarativeRuntimeKind = 'view' | 'widget';

export interface DeclarativeWidgetTypeResolver {
  hasType(type: string): boolean;
}

export interface DeclarativeRuntimeSupport {
  readonly type: string;
  readonly supportsView: boolean;
  readonly supportsWidget: boolean;
  readonly kinds: readonly DeclarativeRuntimeKind[];
  readonly preferred: DeclarativeRuntimeKind | null;
}

export interface DeclarativeRuntimeOptions {
  readonly host?: DeclarativeWidgetTypeResolver | null;
  readonly prefer?: DeclarativeRuntimeKind;
  readonly viewDeps?: DeclarativeViewRuntimeDeps;
}

export type DeclarativeRuntimeArtifact =
  | {
      readonly kind: 'view';
      readonly spec: WidgetSpec;
      readonly view: View;
    }
  | {
      readonly kind: 'widget';
      readonly spec: WidgetSpec;
      readonly spawnInput: ReturnType<typeof widgetSpawnInputFromSpec>;
    };

function runtimeKindsFor(
  spec: DeclarativeWidgetNode,
  host: DeclarativeWidgetTypeResolver | null | undefined,
): DeclarativeRuntimeKind[] {
  const built = buildWidgetSpec(spec);
  const kinds: DeclarativeRuntimeKind[] = [];
  if (hasDeclarativeViewFactory(built.type)) kinds.push('view');
  if (host?.hasType(built.type)) kinds.push('widget');
  return kinds;
}

export function resolveDeclarativeRuntimeSupport(
  spec: DeclarativeWidgetNode,
  options: DeclarativeRuntimeOptions = {},
): DeclarativeRuntimeSupport {
  const built = buildWidgetSpec(spec);
  const kinds = runtimeKindsFor(spec, options.host);
  const preferred = options.prefer && kinds.includes(options.prefer)
    ? options.prefer
    : (kinds[0] ?? null);
  return {
    type: built.type,
    supportsView: kinds.includes('view'),
    supportsWidget: kinds.includes('widget'),
    kinds,
    preferred,
  };
}

export function createDeclarativeRuntimeArtifact(
  spec: DeclarativeWidgetNode,
  options: DeclarativeRuntimeOptions = {},
): DeclarativeRuntimeArtifact {
  const built = buildWidgetSpec(spec);
  const support = resolveDeclarativeRuntimeSupport(spec, options);
  if (support.preferred === 'view') {
    return {
      kind: 'view',
      spec: built,
      view: createDeclarativeView(built, options.viewDeps),
    };
  }
  if (support.preferred === 'widget') {
    return {
      kind: 'widget',
      spec: built,
      spawnInput: widgetSpawnInputFromSpec(built),
    };
  }
  throw new Error(`no declarative runtime available for "${built.type}"`);
}
