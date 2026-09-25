// EnterPlanMode / ExitPlanMode ToolRuntime wrappers — Phase WF4.

import {
  buildEnterPlanModeTool, dispatchEnterPlanMode,
  buildExitPlanModeTool, dispatchExitPlanMode,
} from '../plan-mode/index.js';
import type { ToolRuntime } from './types.js';

export const enterPlanModeRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'enter_plan_mode',
  spec: buildEnterPlanModeTool(),
  async run(req) {
    const r = await dispatchEnterPlanMode(req);
    return { output: r.output };
  },
};

export const exitPlanModeRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'exit_plan_mode',
  spec: buildExitPlanModeTool(),
  async run(req) {
    const r = await dispatchExitPlanMode(req);
    return { output: r.output };
  },
};

export const ALL_PLAN_MODE_RUNTIMES = [enterPlanModeRuntime, exitPlanModeRuntime] as const;
