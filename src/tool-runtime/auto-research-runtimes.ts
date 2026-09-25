// ── PFC-S4 P6: auto-research ToolRuntime wrappers ──

import {
  buildResearchPlanTool,
  dispatchResearchPlan,
  type ResearchPlanInput,
  type ResearchPlanResult,
} from '../auto-research/tools/research-plan.js';
import {
  buildQuestionQueueTool,
  dispatchQuestionQueue,
  type QuestionQueueInput,
  type QuestionQueueResult,
} from '../auto-research/tools/question-queue.js';
import {
  buildBudgetTool,
  dispatchBudget,
  type BudgetInput,
  type BudgetResult,
} from '../auto-research/tools/budget.js';
import {
  buildTerminationCheckTool,
  dispatchTerminationCheck,
  type TerminationCheckInput,
  type TerminationCheckResult,
} from '../auto-research/tools/termination-check.js';
import {
  buildEnterAutoModeTool,
  dispatchEnterAutoMode,
  buildExitAutoModeTool,
  dispatchExitAutoMode,
} from '../auto-research/auto-mode/index.js';
import type { ToolRuntime } from './types.js';

export const researchPlanRuntime: ToolRuntime<ResearchPlanInput, ResearchPlanResult> = {
  id: 'research_plan',
  spec: buildResearchPlanTool(),
  async run(req) { return dispatchResearchPlan(req); },
};

export const questionQueueRuntime: ToolRuntime<QuestionQueueInput, QuestionQueueResult> = {
  id: 'question_queue',
  spec: buildQuestionQueueTool(),
  async run(req) { return dispatchQuestionQueue(req); },
};

export const budgetRuntime: ToolRuntime<BudgetInput, BudgetResult> = {
  id: 'budget',
  spec: buildBudgetTool(),
  async run(req) { return dispatchBudget(req); },
};

export const terminationCheckRuntime: ToolRuntime<TerminationCheckInput, TerminationCheckResult> = {
  id: 'termination_check',
  spec: buildTerminationCheckTool(),
  async run(req) { return dispatchTerminationCheck(req); },
};

export const enterAutoModeRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'enter_auto_mode',
  spec: buildEnterAutoModeTool(),
  async run(req) {
    const r = await dispatchEnterAutoMode(req);
    return { ...r };
  },
};

export const exitAutoModeRuntime: ToolRuntime<Record<string, unknown>, { output: string }> = {
  id: 'exit_auto_mode',
  spec: buildExitAutoModeTool(),
  async run(req) {
    const r = await dispatchExitAutoMode(req);
    return { ...r };
  },
};

export const ALL_AUTO_RESEARCH_RUNTIMES = [
  researchPlanRuntime,
  questionQueueRuntime,
  budgetRuntime,
  terminationCheckRuntime,
  enterAutoModeRuntime,
  exitAutoModeRuntime,
] as const;
