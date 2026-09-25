import { createLayout, locate, placeWidget } from '../layout/host.js';
import type { Layout, ModalPlacement } from '../layout/types.js';
import {
  type DeclarativeWidgetNode,
  widgetSpawnInputFromSpec,
} from '../ui/declarative/index.js';
import { resolveSingleScenarioWidget } from './scenario-mount-node.js';
import { mountScenarioIntoModal, type ScenarioModalMountDeps } from './scenario-modal-mount.js';

export interface ScenarioWidgetMountDeps extends ScenarioModalMountDeps {
  readonly getDashboardManagedWidgetIds: () => readonly string[];
}

function findDashboardModalByWidgetId(
  modals: readonly ModalPlacement[],
  widgetId: string,
): ModalPlacement | null {
  return modals.find(modal => modal.widgetInstanceId === widgetId) ?? null;
}

function replacePluginLayoutWidget(
  layout: Layout,
  widgetId: string,
  nextWidgetId: string,
): Layout | null {
  const pos = locate(layout, widgetId);
  if (pos) return placeWidget(layout, pos.row, pos.col, nextWidgetId);

  const modalIdx = layout.modals.findIndex(modal => modal.widgetInstanceId === widgetId);
  if (modalIdx >= 0) {
    return createLayout(
      layout.rows,
      layout.modals.map((modal, idx) => idx === modalIdx
        ? { ...modal, widgetInstanceId: nextWidgetId }
        : modal),
    );
  }
  return null;
}

export function mountScenarioIntoWidget(
  widgets: readonly DeclarativeWidgetNode[],
  widgetId: string,
  deps: ScenarioWidgetMountDeps,
): { mounted: boolean; error?: string } {
  const resolved = resolveSingleScenarioWidget(widgets, 'widget');
  if (!resolved.widget) return { mounted: false, error: resolved.error };
  const widget = resolved.widget;

  const dashboardManaged = new Set(deps.getDashboardManagedWidgetIds());
  if (dashboardManaged.has(widgetId)) {
    return {
      mounted: false,
      error:
        `RunScenario: target widget "${widgetId}" is dashboard-managed; `
        + 'widget target mount currently supports only plugin-layout or modal-hosted widgets',
    };
  }

  const dashboardModal = findDashboardModalByWidgetId(deps.getDashboardModals(), widgetId);
  if (dashboardModal) {
    return mountScenarioIntoModal(widgets, dashboardModal.id, deps);
  }

  const pluginLayout = deps.getPluginLayout();
  if (!pluginLayout) {
    return {
      mounted: false,
      error:
        `RunScenario: target widget "${widgetId}" was not found in a modal or active plugin layout`,
    };
  }

  const nextLayout = replacePluginLayoutWidget(pluginLayout, widgetId, '__pending__');
  if (!nextLayout) {
    return {
      mounted: false,
      error:
        `RunScenario: target widget "${widgetId}" was not found in a modal or active plugin layout`,
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
    deps.setPluginLayout(replacePluginLayoutWidget(pluginLayout, widgetId, nextWidget.id)!);
    deps.disposeWidget(widgetId);
    return { mounted: true };
  } catch (err) {
    return {
      mounted: false,
      error: `RunScenario: target widget mount failed: ${(err as Error).message}`,
    };
  }
}
