// Goals barrel — Plan-Mode UX P1.

export {
  DEFAULT_GOAL_BUDGET,
  type Goal,
  type GoalBudget,
  type GoalCreateInput,
  type GoalError,
  type GoalJudgeVerdict,
  type GoalMode,
  type GoalStatus,
  type GoalUsage,
} from './types.js';

export {
  clearGoal,
  generateGoalId,
  getCurrentGoal,
  isGoalActive,
  isOverBudget,
  recordTurn,
  setBudget,
  setLastVerdict,
  setStatus,
  startGoal,
  subscribe as subscribeGoal,
  _resetForTesting,
} from './registry.js';
