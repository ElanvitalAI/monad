// Plan-mode barrel — Phase WF3.

export {
  INACTIVE_PLAN_MODE_STATE,
  type PlanArtifact,
  type PlanModeError,
  type PlanModeState,
  type PlanPhase,
} from './types.js';

export {
  getPlanModeState,
  isPlanModeActive,
  setPlanModeState,
  setPlanPhase,
  resetPlanModeState,
  subscribePlanMode,
  generatePlanSessionId,
  _clearPlanModeListenersForTesting,
} from './session.js';

export { assertPlanGate } from './write-gate.js';

export {
  planDir, planFilePathFor,
  initPlanArtifact, loadPlanArtifact, loadPlanArtifactFromPath,
  type PlanArtifactSeed,
} from './persistence.js';

export {
  createPlanExitModal,
  type PlanExitChoice, type PlanExitModalHandle, type PlanExitModalSpec,
} from './exit-modal.js';

export {
  buildEnterPlanModeTool, dispatchEnterPlanMode,
  type EnterPlanModeResult,
} from './tool-enter.js';

export {
  buildExitPlanModeTool, dispatchExitPlanMode,
  setExitPlanModeDeps, getExitPlanModeDeps,
  type ExitPlanModeDeps, type ExitPlanModeResult,
} from './tool-exit.js';

export {
  buildPlanModeSystemPrompt, buildPlanModeSystemMessages,
} from './system-prompt.js';
