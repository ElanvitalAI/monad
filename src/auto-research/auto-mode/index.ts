// ── PFC-S4 P5: auto-mode barrel ──

export { buildEnterAutoModeTool, dispatchEnterAutoMode } from './tool-enter.js';
export type { EnterAutoModeInput, EnterAutoModeResult, EnterAutoModeDispatchOpts } from './tool-enter.js';

export { buildExitAutoModeTool, dispatchExitAutoMode } from './tool-exit.js';
export type { ExitAutoModeInput, ExitAutoModeResult, ExitAutoModeDispatchOpts } from './tool-exit.js';

export {
  getAutoModeState,
  setAutoModeState,
  isAutoModeActive,
  subscribeAutoMode,
  resetAutoModeForTest,
  generateAutoModeSessionId,
} from './session.js';

export {
  INACTIVE_AUTO_MODE_STATE,
  AUTO_MODE_DEFAULT_MAX_TURNS,
  AUTO_MODE_HARD_MAX_TURNS,
} from './types.js';
export type {
  AutoModeState,
  AutoModePhase,
  AutoModeExitReason,
} from './types.js';
