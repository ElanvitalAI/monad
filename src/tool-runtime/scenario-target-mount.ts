import type { SurfaceAddress } from '../surface/address.js';
import type { DeclarativeWidgetNode } from '../ui/declarative/index.js';
import {
  mountScenarioIntoPane,
  mountScenarioIntoWindow,
  type ScenarioWindowMountDeps,
} from './scenario-window-mount.js';
import {
  mountScenarioIntoModal,
  type ScenarioModalMountDeps,
} from './scenario-modal-mount.js';
import {
  mountScenarioIntoWidget,
  type ScenarioWidgetMountDeps,
} from './scenario-widget-mount.js';

export interface ScenarioTargetMountDeps
  extends ScenarioWindowMountDeps, ScenarioWidgetMountDeps {}

export const RUN_SCENARIO_MOUNT_TARGET_KINDS = [
  'window',
  'pane',
  'modal',
  'widget',
] as const;

export type RunScenarioMountTargetKind =
  typeof RUN_SCENARIO_MOUNT_TARGET_KINDS[number];

export function isRunScenarioMountTargetKind(
  kind: SurfaceAddress['kind'],
): kind is RunScenarioMountTargetKind {
  return kind === 'window'
    || kind === 'pane'
    || kind === 'modal'
    || kind === 'widget';
}

export function unsupportedRunScenarioTargetError(target: SurfaceAddress): string {
  switch (target.kind) {
    case 'input':
      return `RunScenario: target kind "${target.kind}" is not a mount container; `
        + 'target binding currently mounts widgets and panes, not live input surfaces';
    case 'popover':
      return `RunScenario: target kind "${target.kind}" is transient and not a scenario mount destination`;
    case 'inline':
      return `RunScenario: target kind "${target.kind}" is a one-line inline surface and not a scenario mount destination`;
    case 'bg':
      return `RunScenario: target kind "${target.kind}" is a background/session surface and not a scenario mount destination`;
    case 'window':
    case 'pane':
    case 'modal':
    case 'widget':
      return `RunScenario: target kind "${target.kind}" requires a mount helper, not unsupportedRunScenarioTargetError()`;
  }
}

export function mountScenarioIntoTarget(
  widgets: readonly DeclarativeWidgetNode[],
  target: SurfaceAddress,
  deps: ScenarioTargetMountDeps,
): { mounted: boolean; error?: string } {
  switch (target.kind) {
    case 'window':
      return mountScenarioIntoWindow(widgets, target.windowId, deps);
    case 'pane': {
      const windowId = Number(target.ref.windowId);
      if (!Number.isInteger(windowId) || windowId <= 0) {
        return {
          mounted: false,
          error: `RunScenario: target pane windowId "${target.ref.windowId}" is not a valid VW id`,
        };
      }
      return mountScenarioIntoPane(widgets, {
        windowId,
        paneId: target.ref.paneId,
      }, deps);
    }
    case 'modal':
      return mountScenarioIntoModal(widgets, target.modalId, deps);
    case 'widget':
      return mountScenarioIntoWidget(widgets, target.widgetId, deps);
    case 'input':
    case 'popover':
    case 'inline':
    case 'bg':
      return {
        mounted: false,
        error: unsupportedRunScenarioTargetError(target),
      };
  }
}
