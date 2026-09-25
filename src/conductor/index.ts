// ── PFC-S2 generalization: Conductor barrel ──

export type {
  GoalKind,
  Intake,
  ClassifyInput,
  ClassifyResult,
  LLMClassifyResult,
  KeywordEntry,
  HeuristicTable,
  AdapterResult,
  AdapterStatus,
  Adapter,
  RoutingContext,
  RouterDeps,
} from './types.js';
export { GOAL_KINDS } from './types.js';

export {
  HEURISTIC_TABLE,
  MIN_SCORE,
  MIN_CONFIDENCE,
  DEFAULT_FALLBACK_KIND,
  classify,
  scoreIntake,
  argmaxWithRunnerUp,
  confidence,
} from './classifier.js';

export {
  DEFAULT_ADAPTERS,
  selectAdapter,
} from './routing.js';

export { researchAdapter } from './adapters/research.js';
export { codingAdapter } from './adapters/coding.js';
export { analysisAdapter } from './adapters/analysis.js';
export { monitoringAdapter } from './adapters/monitoring.js';
export { refactorAdapter } from './adapters/refactor.js';

export {
  dispatchGoalKind,
} from './dispatch.js';
export type {
  DispatchInput,
  DispatchResult,
} from './dispatch.js';

export {
  buildClassifyGoalTool,
  dispatchClassifyGoal,
} from './tools/classify-goal.js';
export type {
  ClassifyGoalToolInput,
  ClassifyGoalToolResult,
} from './tools/classify-goal.js';

// ── T1 (Phase 1) — PFC reverse-feedback ──
export {
  postureDeath,
  createPfcShellWatcher,
} from './pfc-shell-watcher.js';
export type {
  PfcShellDeathSignal,
  PfcShellDeathListener,
  PfcShellWatcher,
  PfcShellWatcherDeps,
} from './pfc-shell-watcher.js';

export {
  createPfcReverseFeedback,
} from './pfc-reverse-feedback.js';
export type {
  PfcReverseFeedback,
  PfcReverseFeedbackDeps,
  PfcReverseFeedbackNotification,
  PfcReverseFeedbackSink,
} from './pfc-reverse-feedback.js';
