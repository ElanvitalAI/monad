import { createLayout } from '../layout/host.js';
import type { Layout, ModalPlacement } from '../layout/types.js';
import {
  type DeclarativeWidgetNode,
  widgetSpawnInputFromSpec,
} from '../ui/declarative/index.js';
import { resolveSingleScenarioWidget } from './scenario-mount-node.js';

export interface ScenarioModalMountDeps {
  readonly spawnWidget: (spec: {
    type: string;
    id?: string;
    character?: string;
    config?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  }) => { id: string };
  readonly disposeWidget: (id: string) => void;
  readonly getDashboardModals: () => readonly ModalPlacement[];
  readonly setDashboardModals: (modals: readonly ModalPlacement[]) => void;
  readonly getPluginLayout: () => Layout | null;
  readonly setPluginLayout: (layout: Layout) => void;
}

function replacementModalArray(
  modals: readonly ModalPlacement[],
  modalId: string,
  widgetInstanceId: string,
): readonly ModalPlacement[] | null {
  let found = false;
  const next = modals.map(modal => {
    if (modal.id !== modalId) return modal;
    found = true;
    return { ...modal, widgetInstanceId };
  });
  return found ? next : null;
}

export function mountScenarioIntoModal(
  widgets: readonly DeclarativeWidgetNode[],
  modalId: string,
  deps: ScenarioModalMountDeps,
): { mounted: boolean; error?: string } {
  const resolved = resolveSingleScenarioWidget(widgets, 'modal');
  if (!resolved.widget) return { mounted: false, error: resolved.error };
  const widget = resolved.widget;

  const dashboardModals = deps.getDashboardModals();
  const dashboardNext = replacementModalArray(dashboardModals, modalId, '__pending__');
  const pluginLayout = deps.getPluginLayout();
  const pluginNext = pluginLayout
    ? replacementModalArray(pluginLayout.modals, modalId, '__pending__')
    : null;

  const currentWidgetId = dashboardNext
    ? dashboardModals.find(modal => modal.id === modalId)!.widgetInstanceId
    : pluginNext && pluginLayout
      ? pluginLayout.modals.find(modal => modal.id === modalId)!.widgetInstanceId
      : null;

  if (!currentWidgetId) {
    return {
      mounted: false,
      error: `RunScenario: target modal "${modalId}" was not found`,
    };
  }

  try {
    const nextWidgetInput = widgetSpawnInputFromSpec(widget);
    const nextWidget = deps.spawnWidget({
      ...nextWidgetInput,
      // E8 — DeclarativeWidgetSpawnMeta has typed fields · double-cast
      // through unknown to satisfy Record<string, unknown> signature.
      meta: nextWidgetInput.meta as unknown as Record<string, unknown>,
    });

    if (dashboardNext) {
      deps.setDashboardModals(
        dashboardNext.map(modal => modal.id === modalId
          ? { ...modal, widgetInstanceId: nextWidget.id }
          : modal),
      );
    } else if (pluginNext && pluginLayout) {
      deps.setPluginLayout(createLayout(
        pluginLayout.rows,
        pluginNext.map(modal => modal.id === modalId
          ? { ...modal, widgetInstanceId: nextWidget.id }
          : modal),
      ));
    }

    deps.disposeWidget(currentWidgetId);
    return { mounted: true };
  } catch (err) {
    return {
      mounted: false,
      error: `RunScenario: target modal mount failed: ${(err as Error).message}`,
    };
  }
}
