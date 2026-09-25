/**
 * @deprecated Import from `src/session-runtime/posture.ts` instead.
 *
 * Legacy compatibility wrapper only. No new imports should target
 * this path; keep it until downstream callers are fully migrated.
 */

export {
  armQuickControlOnce,
  consumeQuickControlOnce,
  createChatModeState,
  enterControlMode,
  exitControlMode,
  isControlMode,
  modeElapsedLabel,
  parseControlSlash,
  setPreferredSurface,
  toggleControlMode,
  type ChatMode,
  type ChatModeState,
  type ChatPosture,
  type ControlSlashOutcome,
  type EnterModeOpts,
} from '../../session-runtime/posture.js';
