import type { WidgetSpec } from './spec.js';
import type { View } from '../view.js';
import {
  builtinDeclarativeViewDefinitions,
  type BuiltinDeclarativeViewDefinition,
  type DeclarativeViewRuntimeDeps,
} from './builtin-view-catalog.js';
export type { DeclarativeViewRuntimeDeps } from './builtin-view-catalog.js';
import { registerWidgetSchema } from './schema.js';

type DeclarativeViewFactory = (
  spec: WidgetSpec,
  deps: DeclarativeViewRuntimeDeps,
) => View;

export interface DeclarativeViewDefinition extends BuiltinDeclarativeViewDefinition {}

const registry = new Map<string, DeclarativeViewFactory>();

function registerBuiltinViewFactories(): void {
  if (registry.size > 0) return;
  for (const def of builtinDeclarativeViewDefinitions) {
    registry.set(def.type, def.createView);
  }
}

export function registerDeclarativeViewFactory(type: string, factory: DeclarativeViewFactory): () => void {
  registry.set(type, factory);
  return () => {
    if (registry.get(type) === factory) registry.delete(type);
  };
}

export function registerDeclarativeViewDefinition(def: DeclarativeViewDefinition): () => void {
  const disposeFactory = registerDeclarativeViewFactory(def.type, def.createView);
  const disposeSchema = registerWidgetSchema({
    type: def.type,
    description: def.description,
    configSchema: def.configSchema,
  });
  return () => {
    disposeFactory();
    disposeSchema();
  };
}

export function hasDeclarativeViewFactory(type: string): boolean {
  registerBuiltinViewFactories();
  return registry.has(type);
}

export function canCreateDeclarativeView(spec: WidgetSpec): boolean {
  return hasDeclarativeViewFactory(spec.type);
}

export function createDeclarativeView(
  spec: WidgetSpec,
  deps: DeclarativeViewRuntimeDeps = {},
): View {
  registerBuiltinViewFactories();
  const factory = registry.get(spec.type);
  if (!factory) throw new Error(`no declarative view factory registered for "${spec.type}"`);
  return factory(spec, deps);
}
