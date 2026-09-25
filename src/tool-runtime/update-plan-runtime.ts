// update_plan ToolRuntime wrapper — Phase WF2.

import { buildUpdatePlanTool, dispatchUpdatePlan } from '../code-edit/plan-tool.js';
import type { ToolRuntime } from './types.js';

export const updatePlanRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'update_plan',
  spec: buildUpdatePlanTool(),
  async run(req) {
    const r = await dispatchUpdatePlan(req);
    return { output: r.output };
  },
};
