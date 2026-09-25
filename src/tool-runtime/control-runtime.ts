// ── Control tool runtimes — Phase D wiring ──
//
// Five mutation tools sit next to the existing virtual-window /
// PTY-shell surfaces rather than replacing them. Each is exposed via
// `skill` + `dashboard` surfaces; none on `mcp` by default (mutating
// — add per-tool when an external flow needs it).

import {
  buildControlTools,
  dispatchControlWindowResize,
  dispatchControlPaneResize,
  dispatchControlPaneLayout,
  dispatchControlToolToggle,
  dispatchControlPromptAppend,
  dispatchControlPromptClear,
} from '../skills/tools/control.js';
import type { ToolRuntime } from './types.js';

function asRuntime<Req extends Record<string, unknown>>(
  id: string,
  specIdx: number,
  fn: (req: Req) => Promise<unknown>,
): ToolRuntime<Req, any> {
  const specs = buildControlTools();
  return {
    id,
    spec: specs[specIdx]!,
    async run(req) {
      return fn(req) as Promise<any>;
    },
  };
}

export const controlWindowResizeRuntime  = asRuntime('control_window_resize',  0, dispatchControlWindowResize);
export const controlPaneResizeRuntime    = asRuntime('control_pane_resize',    1, dispatchControlPaneResize);
export const controlPaneLayoutRuntime    = asRuntime('control_pane_layout',    2, dispatchControlPaneLayout);
export const controlToolToggleRuntime    = asRuntime('control_tool_toggle',    3, dispatchControlToolToggle);
export const controlPromptAppendRuntime  = asRuntime('control_prompt_append',  4, dispatchControlPromptAppend);
export const controlPromptClearRuntime   = asRuntime('control_prompt_clear',   5, dispatchControlPromptClear);

export const ALL_CONTROL_RUNTIMES: ToolRuntime<any, any>[] = [
  controlWindowResizeRuntime,
  controlPaneResizeRuntime,
  controlPaneLayoutRuntime,
  controlToolToggleRuntime,
  controlPromptAppendRuntime,
  controlPromptClearRuntime,
];
