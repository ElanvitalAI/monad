// ── Context tool runtimes — Phase C wiring ──
//
// Each context.* LLM tool gets its own ToolRuntime entry so surface
// filtering (skill vs dashboard vs mcp) and approval gating stay per-
// tool. All read-only → no approver slot used.
//
// Shared deps (cwd/remoteHost, window-registry getter, session getter,
// pane-capture) flow through a DI record set at dashboard boot — skills
// call this with {} and still receive useful answers for workspace/
// tools/ptys/events which don't need dashboard state.
//
// Surface-unification v2.2 V2.2-5 (2026-05-11) — scheduler getter slot
// retired with the `context.jobs.list` tool (scheduler view 폐기).

import {
  buildContextTools,
  dispatchContextWorkspace,
  dispatchContextWindowsList,
  dispatchContextWindowDetail,
  dispatchContextPaneDetail,
  dispatchContextPtysList,
  dispatchContextPtyDetail,
  dispatchContextSessionsList,
  dispatchContextWidgetsList,
  dispatchContextPluginsList,
  dispatchContextToolsList,
  dispatchContextEventsTail,
  dispatchContextBootstrap,
  type ContextDeps,
} from '../skills/tools/context.js';
import type { ToolRuntime } from './types.js';

let deps: ContextDeps = {};

/** Dashboard boot wires cwd/remote/window-registry/session/scheduler
 *  here so `context.*` tools see the live rig. Skills call this with
 *  {} and still get useful answers for workspace/tools/ptys/events. */
export function setContextRuntimeDeps(next: ContextDeps): void {
  deps = { ...next };
}

function asRuntime<Req extends Record<string, unknown>>(
  id: string,
  specIdx: number,
  fn: (req: Req, deps?: ContextDeps) => Promise<unknown>,
): ToolRuntime<Req, any> {
  const specs = buildContextTools();
  return {
    id,
    spec: specs[specIdx]!,
    async run(req) {
      return fn(req, deps) as Promise<any>;
    },
  };
}

// Tool index mirrors buildContextTools() order — keep in sync.
export const contextWorkspaceRuntime     = asRuntime('context_workspace',       0,  dispatchContextWorkspace);
export const contextWindowsListRuntime   = asRuntime('context_windows_list',    1,  dispatchContextWindowsList);
export const contextWindowDetailRuntime  = asRuntime('context_window_detail',   2,  dispatchContextWindowDetail);
export const contextPaneDetailRuntime    = asRuntime('context_pane_detail',     3,  dispatchContextPaneDetail);
export const contextPtysListRuntime      = asRuntime('context_ptys_list',       4,  dispatchContextPtysList);
export const contextPtyDetailRuntime     = asRuntime('context_pty_detail',      5,  dispatchContextPtyDetail);
export const contextSessionsListRuntime  = asRuntime('context_sessions_list',   6,  dispatchContextSessionsList);
// Surface-unification v2.2 V2.2-5 (2026-05-11) — `contextJobsListRuntime`
// retired (scheduler view 폐기 · spec idx 7 자리 빈 슬롯이 아니라 후속
// runtime 들이 한 칸씩 위로 시프트).
export const contextWidgetsListRuntime   = asRuntime('context_widgets_list',    7,  dispatchContextWidgetsList);
export const contextPluginsListRuntime   = asRuntime('context_plugins_list',    8,  dispatchContextPluginsList);
export const contextToolsListRuntime     = asRuntime('context_tools_list',      9,  dispatchContextToolsList);
export const contextEventsTailRuntime    = asRuntime('context_events_tail',    10,  dispatchContextEventsTail);
export const contextBootstrapRuntime     = asRuntime('context_bootstrap',      11,  dispatchContextBootstrap);

export const ALL_CONTEXT_RUNTIMES: ToolRuntime<any, any>[] = [
  contextWorkspaceRuntime,
  contextWindowsListRuntime,
  contextWindowDetailRuntime,
  contextPaneDetailRuntime,
  contextPtysListRuntime,
  contextPtyDetailRuntime,
  contextSessionsListRuntime,
  contextWidgetsListRuntime,
  contextPluginsListRuntime,
  contextToolsListRuntime,
  contextEventsTailRuntime,
  contextBootstrapRuntime,
];
