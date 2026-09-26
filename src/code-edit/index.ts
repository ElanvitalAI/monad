// Code-editing barrel. Consumers import from here to avoid reaching
// into individual files — keeps the public surface narrow while the
// internals churn across CE phases.

export { ReadFileStateStore, hashContent } from './read-state.js';
export {
  applyEditsInMemory,
  computePatch,
  countPatchChanges,
  DEFAULT_CONTEXT_LINES,
  type ApplyEditsResult,
} from './diff-compute.js';
export { applyEdit, applyRead, applyWrite } from './apply.js';
export {
  renderEditBlock,
  renderEditBlockAsync,
  detectTerminalBgLightness,
  detectTerminalColorLevel,
  resolveDiffPalette,
  resolveDiffRenderVariant,
  buildDiffRenderCacheKey,
  _clearDiffRenderCacheForTesting,
  _getDiffRenderCacheStatsForTesting,
  CODE_PREVIEW_MAX_LINE_WIDTH,
  type DiffRenderOptions,
  type DiffColorTier,
  type DiffHeaderStyle,
  type DiffRenderVariant,
} from './diff-render.js';
export {
  highlightCode, detectLanguage, _resetSyntaxHighlighterForTesting,
  type HighlightedLines, type SyntaxToken,
} from './syntax-highlight.js';
export {
  subscribeEditResult,
  subscribeSourceDelta,
  publishEditResult,
  _clearEditResultListenersForTesting,
} from './events.js';
export {
  assessEdit, assessWrite,
  getPolicy, setPolicy, resetPolicyToDefault,
  setCodeEditApprover, getCodeEditApprover,
  type CodeEditApprover, type CodeEditApprovalRequest,
} from './safety.js';
export {
  findElanousRepoRoot,
  getDefaultSystemFileDirs,
  setSystemFileGuardDisabled,
  isSystemFileGuardDisabled,
  __resetSystemFileGuard,
} from './system-file-guard.js';
export {
  TurnDiffTracker,
  getTurnDiffTracker,
  _setTurnDiffTrackerForTesting,
  renderTurnSummary,
  type TurnDiffEntry,
} from './turn-diff-tracker.js';
export {
  SourceDeltaManager,
  getSourceDeltaManager,
  _setSourceDeltaManagerForTesting,
  renderSourceDeltaTurnSummary,
  type SourceDeltaEvent,
  type SourceDeltaFile,
  type SourceDeltaTurnSnapshot,
} from './source-delta.js';
export {
  buildSourceDeltaBrowserOptions,
  createSourceDeltaBrowserPopup,
  renderSourceDeltaFilePreview,
  renderSourceDeltaTurnPreview,
  type SourceDeltaBrowserMode,
  type SourceDeltaBrowserOptionValue,
  type SourceDeltaBrowserOpts,
} from './source-delta-browser.js';
export {
  buildUpdatePlanTool, dispatchUpdatePlan, parseUpdatePlanArgs,
  getPlanState, subscribePlanUpdate, setPlanToolPlanModeGuard,
  _resetPlanStateForTesting, _clearPlanListenersForTesting,
  type PlanStep, type PlanStepStatus, type UpdatePlanArgs,
  type PlanState, type UpdatePlanDispatchResult,
} from './plan-tool.js';
export { renderPlanBoard, type PlanRenderOptions } from './plan-renderer.js';
export {
  buildApprovalPolicyPrompt,
  buildApprovalPolicySystemMessages,
} from './approval-prompts.js';
export {
  buildReadTool, buildEditTool, buildWriteTool,
  dispatchRead, dispatchEdit, dispatchWrite,
  getCodeEditStore, _setCodeEditStoreForTesting,
  type CodeEditDispatchResult,
} from './tools.js';
export {
  EditErrorCode,
  type ApprovalPolicy,
  type EditError,
  type EditOutcome,
  type EditRequest,
  type EditResult,
  type EditSpec,
  type ReadFileEntry,
  type SafetyDecision,
  type StructuredPatchHunk,
  type WriteRequest,
} from './types.js';
