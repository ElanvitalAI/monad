// ── IUL Phase L (subset) — surface-ui ToolRuntime wrappers ──
//
// Bridges `dispatchGetUIState` / `dispatchDescribeSurface` /
// `dispatchObserveSurface` (src/surface/llm-tools.ts) into the
// `ToolRuntime` shape so dashboard / skill-runner / future MCP
// exports use the same `dispatchToolByName('GetUIState', args)` entry.
//
// Read-only by design — none of the three tools mutate any state.
// `MaterializeFromIntent` (write-side companion) is widget-team
// owned and lands as `src/tool-runtime/materialize-runtimes.ts`
// (PLAN-iul-closure-roadmap §0.5 reverse-ACK).
//
// `registerSurfaceUIRuntimes(deps)` is called once from dashboard
// boot; deps carries the runtime widget-host so DescribeSurface(widget)
// can read instance + def metadata. Idempotent — re-entry during
// hot reload is safe.

import {
  buildDescribeSurfaceTool,
  buildGetUIStateTool,
  buildObserveSurfaceTool,
  dispatchDescribeSurface,
  dispatchGetUIState,
  dispatchObserveSurface,
  type SurfaceUIDeps,
  type SurfaceUIWidgetHost,
} from '../surface/llm-tools.js';
import type { PaneVisualStateStore } from '../panes/visual-state.js';
import { registerToolRuntime } from './registry.js';
import type { ToolRuntime } from './types.js';

type Args = Record<string, unknown>;
type Out = { output: string };

function stringify(obj: unknown): Out {
  return { output: JSON.stringify(obj) };
}

let _depsRef: SurfaceUIDeps = {};

export function getUIStateRuntime(): ToolRuntime<Args, Out> {
  return {
    id: 'surface_get_ui_state',
    spec: buildGetUIStateTool(),
    async run(req) {
      return stringify(dispatchGetUIState(req, _depsRef));
    },
  };
}

export function describeSurfaceRuntime(): ToolRuntime<Args, Out> {
  return {
    id: 'surface_describe',
    spec: buildDescribeSurfaceTool(),
    async run(req) {
      return stringify(dispatchDescribeSurface(req, _depsRef));
    },
  };
}

export function observeSurfaceRuntime(): ToolRuntime<Args, Out> {
  return {
    id: 'surface_observe',
    spec: buildObserveSurfaceTool(),
    async run(req) {
      const result = await dispatchObserveSurface(req, _depsRef);
      return stringify(result);
    },
  };
}

let registered = false;

export interface RegisterSurfaceUIDeps {
  /** Runtime widget-host. Optional — when absent, DescribeSurface
   *  for widget kind degrades to registry passthrough. */
  readonly widgetHost?: SurfaceUIWidgetHost;
  /** Bundle B-8-β — PaneVisualStateStore. Optional; when present,
   *  DescribeSurface(pane) attaches `detail.visualState`. */
  readonly store?: PaneVisualStateStore;
}

/** Idempotent registration — called by dashboard boot. The deps closure
 *  is captured by reference so a later call updates the surface used by
 *  in-flight runs (test harness / hot reload). */
export function registerSurfaceUIRuntimes(opts: RegisterSurfaceUIDeps = {}): void {
  _depsRef = {
    ...(opts.widgetHost !== undefined ? { widgetHost: opts.widgetHost } : {}),
    ...(opts.store !== undefined ? { store: opts.store } : {}),
  };
  if (registered) return;
  registerToolRuntime(getUIStateRuntime());
  registerToolRuntime(describeSurfaceRuntime());
  registerToolRuntime(observeSurfaceRuntime());
  registered = true;
}

/** Test-only — reset the global registration + deps. */
export function __resetSurfaceUIRuntimesForTest(): void {
  registered = false;
  _depsRef = {};
}
