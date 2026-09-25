import { loadScenarioCatalog, type ScenarioCatalog } from '../scenarios/index.js';
import { registerScenarioRuntimes } from '../tool-runtime/scenario-runtimes.js';
import { mountScenarioIntoTarget, type ScenarioTargetMountDeps } from '../tool-runtime/scenario-target-mount.js';
import type { ModalPlacement, Layout } from '../layout/types.js';
import type { SurfaceAddress } from '../surface/address.js';
import {
  type DeclarativeWidgetNode,
  widgetSpawnInputFromSpec,
} from '../ui/declarative/index.js';

export const DASHBOARD_SCENARIO_MANAGED_WIDGET_IDS = [
  'wd-browser',
  'wd-obsidian',
  'wd-skill-browser',
  'wd-skill-file',
  'wd-working-browser',
  'wd-preview',
  'wd-scratch',
  'wd-log',
  // Surface-unification v2.2 V2.2-5 Part 2 (2026-05-11) — wd-scheduler-*
  // managed widget id 들 retire (scheduler view 폐기).
  'wd-agent-roster',
  'wd-agent-detail',
  'wd-agent-log',
  'wd-debug-events',
  'wd-debug-detail',
  'wd-debug-stack',
  'wd-debug-prompts',
  'wd-playground',
  'wd-sessions-sidebar',
  'wd-notification-bell',
] as const;

export interface DashboardScenarioRuntimeBootDeps
  // getDashboardManagedWidgetIds is supplied internally by
  // handleScenarioMount (from DASHBOARD_SCENARIO_MANAGED_WIDGET_IDS), so
  // it is NOT part of the caller-facing contract.
  extends Omit<ScenarioTargetMountDeps, 'getDashboardManagedWidgetIds'> {
  scenarioCatalog: ScenarioCatalog | undefined;
  spawnWidget: (spec: {
    type: string;
    id?: string;
    character?: string;
    config?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  }) => { id: string };
  disposeWidget: (id: string) => void;
  // 부모 ScenarioTargetMountDeps 의 구체 타입과 정합(unknown 은 extends 를 깨뜨림).
  getDashboardModals: () => readonly ModalPlacement[];
  setDashboardModals: (modals: readonly ModalPlacement[]) => void;
  getPluginLayout: () => Layout | null;
  setPluginLayout: (layout: Layout) => void;
  registerScenario?: typeof registerScenarioRuntimes;
  mountIntoTarget?: typeof mountScenarioIntoTarget;
}

export async function loadDashboardScenarioCatalog(
  dir: string,
  loadCatalog: typeof loadScenarioCatalog = loadScenarioCatalog,
): Promise<ScenarioCatalog | undefined> {
  try {
    return await loadCatalog(dir, { onDuplicate: 'last-wins' });
  } catch {
    return undefined;
  }
}

export function registerDashboardScenarioRuntimes(
  deps: DashboardScenarioRuntimeBootDeps,
): void {
  (deps.registerScenario ?? registerScenarioRuntimes)({
    getCatalog: () => deps.scenarioCatalog,
    onMount: (widgets, target) => handleScenarioMount(widgets, target, deps),
  });
}

function handleScenarioMount(
  widgets: readonly DeclarativeWidgetNode[],
  target: SurfaceAddress | null | undefined,
  deps: DashboardScenarioRuntimeBootDeps,
): { mounted: boolean; error?: string } {
  if (target) {
    return (deps.mountIntoTarget ?? mountScenarioIntoTarget)(widgets, target, {
      registry: deps.registry,
      createPaneContent: deps.createPaneContent,
      spawnWidget: (spec) => deps.spawnWidget(spec),
      disposeWidget: (id) => {
        try { deps.disposeWidget(id); } catch { /* ignore absent */ }
      },
      getDashboardModals: deps.getDashboardModals,
      setDashboardModals: deps.setDashboardModals,
      getPluginLayout: deps.getPluginLayout,
      setPluginLayout: deps.setPluginLayout,
      getDashboardManagedWidgetIds: () => [...DASHBOARD_SCENARIO_MANAGED_WIDGET_IDS],
    });
  }
  for (const widget of widgets) {
    try {
      const nextWidgetInput = widgetSpawnInputFromSpec(widget);
      deps.spawnWidget({
        ...nextWidgetInput,
        // E8 (§7.4 TS baseline · 2026-05-17) — DeclarativeWidgetSpawnMeta
        // doesn't structurally overlap Record<string, unknown> (specific
        // fields, not index-signatured). Double-cast through unknown.
        meta: nextWidgetInput.meta as unknown as Record<string, unknown>,
      });
    } catch {
      // Per-widget spawn failure is swallowed — RunScenario still
      // reports success with summary-level omissions.
    }
  }
  return { mounted: true };
}
