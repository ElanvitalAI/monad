// PLAN §4.1 · Phase 1.1 — Turn checkpoint barrel.
//
// Single import surface for the rest of the codebase. `streamLLMWithTools`
// pulls in `maybeCaptureDecision` + `mintTurnUri`-shaped helpers; the
// dashboard's `/pause` and `/resume` slashes pull in the request /
// load helpers and the seed formatter.

export type {
  TurnCheckpoint,
  TurnCheckpointDecision,
  TurnCheckpointKind,
  TurnCheckpointLoopSnapshot,
  TurnCheckpointRecentMessage,
} from './types.js';

export {
  setCheckpointDir,
  getCheckpointDir,
  writeCheckpoint,
  loadCheckpoints,
  loadLatest,
  loadMostRecent,
  listCheckpointTurns,
} from './store.js';

export {
  requestPause,
  isPauseRequested,
  consumePauseRequest,
  resetPauseFlag,
} from './pause-flag.js';

export { formatResumeSeed } from './resume.js';
export { formatDebugTrace } from './format-trace.js';

export {
  maybeCaptureDecision,
  isDecisionBoundary,
  type CaptureContext,
  type CaptureResult,
} from './hook.js';
