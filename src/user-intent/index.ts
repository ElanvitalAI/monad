// ── User-Intent fabric (cascade-zyu W1 U0) ──
//
// Public barrel — surface adapters and the NEXUS HTTP endpoint
// import from here. Internal modules import from their concrete
// files (redaction · sinks/jsonl · logger).

export type {
  UserIntentEvent,
  UserIntentEventInput,
  UserIntentSurface,
  UserIntentLayer,
  UserIntentTargetKind,
  UserIntentTarget,
  UserIntentMotion,
  UserIntentMotionKind,
  UserIntentBiometric,
  UserIntentBiometricKind,
  UserIntentLocation,
  UserIntentDetail,
  UserIntentSurfaceState,
  UserIntentContext,
  UserIntentOutcome,
} from './types.js';

export {
  USER_INTENT_SURFACES,
  USER_INTENT_LAYERS,
  isUserIntentSurface,
  isUserIntentLayer,
  isUserIntentEventInput,
} from './types.js';

export {
  UserIntentLogger,
  userIntentLogger,
  _resetUserIntentLogger,
  type UserIntentSink,
  type UserIntentLoggerOptions,
} from './logger.js';

export {
  hashUtteranceValue,
  redactValue,
  redactIntentEvent,
} from './redaction.js';

export {
  writeUserIntentJsonl,
  userIntentJsonlPath,
  setUserIntentJsonlDirOverride,
  latestUserIntentTs,
} from './sinks/jsonl.js';

export {
  buildOtelUserIntentSink,
  bootOtelUserIntentSinkFromEnv,
  type UserIntentOtelSinkOptions,
} from './sinks/otel.js';
