import {
  buildWidgetSpecs,
  type DeclarativeWidgetNode,
  type WidgetSpec,
} from '../ui/declarative/index.js';

export function buildScenarioWidgetSpecs(
  widgets: readonly DeclarativeWidgetNode[],
): readonly WidgetSpec[] {
  return buildWidgetSpecs(widgets);
}

export function resolveSingleScenarioWidget(
  widgets: readonly DeclarativeWidgetNode[],
  kind: 'modal' | 'widget',
): { widget?: WidgetSpec; error?: string } {
  const built = buildScenarioWidgetSpecs(widgets);
  if (built.length !== 1) {
    return {
      error: `RunScenario: target ${kind} mount currently supports exactly one top-level widget`,
    };
  }
  const widget = built[0]!;
  if (widget.children && widget.children.length > 0) {
    return {
      error: `RunScenario: target ${kind} mount does not support nested scenario children yet`,
    };
  }
  return { widget };
}
