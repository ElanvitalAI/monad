// ── PFC-S2: Conductor ToolRuntime wrapper ──

import {
  buildClassifyGoalTool,
  dispatchClassifyGoal,
  type ClassifyGoalToolInput,
  type ClassifyGoalToolResult,
} from '../conductor/tools/classify-goal.js';
import type { ToolRuntime } from './types.js';

export const classifyGoalRuntime: ToolRuntime<ClassifyGoalToolInput, ClassifyGoalToolResult> = {
  id: 'classify_goal',
  spec: buildClassifyGoalTool(),
  async run(req) { return dispatchClassifyGoal(req); },
};

export const ALL_CONDUCTOR_RUNTIMES = [
  classifyGoalRuntime,
] as const;
