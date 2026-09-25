// input-core — unified input policy layer.
//
// Landing as Phase 1 of the plan at
// ~/.claude/plans/snuggly-floating-dawn.md. At P1 we
// expose types + registries only; Phase 2 adds the resolver that
// actually dispatches events against bindings.

export type {
  InputEvent,
  KeyInputEvent,
  MouseInputEvent,
  HitTarget,
} from './event.js';
export {
  keyEvent,
  toMatcher,
  matcherCascade,
} from './event.js';

export type {
  ActionDefinition,
  ActionHandler,
  RegisterActionOptions,
} from './actions.js';
export {
  registerAction,
  getAction,
  hasAction,
  listActions,
  isActionReserved,
  __resetActionRegistryForTests,
} from './actions.js';

export type {
  ReservationViolation,
} from './reserved.js';
export {
  RESERVED_KEYS,
  RESERVED_ACTION_IDS,
  isReservedKey,
  isReservedActionId,
  validateRebind,
} from './reserved.js';

export type { ContextTag, ContextStack } from './context.js';
export {
  pushContext,
  popContext,
  replaceContext,
  currentContext,
  __resetContextForTests,
} from './context.js';

export type { Binding, BindingLayer } from './bindings.js';
export {
  addDefaultBinding,
  setUserConfigBindings,
  setRuntimeBinding,
  clearRuntimeBindingForAction,
  lookupBindings,
  listAllBindings,
  __resetBindingsForTests,
} from './bindings.js';

export type { ResolveResult, ResolverDeps } from './resolver.js';
export { resolveInputEvent, dispatchInputEvent } from './resolver.js';

// U-2a — unified dispatcher + hit-test primitives.
export type {
  DispatchOutcome,
  DispatchPolicy,
  DispatchContext,
  RouteCallbacks,
} from './dispatcher.js';
export {
  routeInputEvent,
  routeInputEventAsync,
  derivePolicyForViewMode,
} from './dispatcher.js';

// I.2 — priority-ordered KeyInterceptor chain · PLAN-compositor-i2-
// interceptor-registry.md. `DragEscInterceptor` is the A-8 migration
// path · future global policies (Ctrl+Q hard quit, chord leader,
// plugin veto) register on the same chain.
export type {
  KeyInterceptor,
  InterceptorRegistry,
} from './interceptor.js';
export { createInterceptorRegistry } from './interceptor.js';
export { createDragEscInterceptor } from './drag-esc-interceptor.js';

export type { HitTestDeps } from './hit-test.js';
export { hitTestAllSurfaces } from './hit-test.js';

// U-3 prep — display → input-core mouse event bridge.
export type {
  BuildMouseOpts,
  TranslatedHitTarget,
} from './mouse-bridge.js';
export {
  translateHitTarget,
  buildMouseInputEventFromDisplay,
} from './mouse-bridge.js';

// A-7a · HitTarget projection to context keys for declarative when-
// clauses.
export { publishMouseTargetToContextKeys } from './mouse-context-publisher.js';

// IDX-2a — ContextKeys + when-clause (pure primitives; dashboard wiring
// lives in IDX-2b).
export type {
  ContextKeys,
  ContextKeyName,
  ContextKeySubscriber,
  ContextKeyService,
} from './context-keys.js';
export {
  INITIAL_CONTEXT_KEYS,
  createContextKeyService,
} from './context-keys.js';

export type {
  WhenClauseContext,
  WhenClauseError,
  WhenClauseResult,
  WhenClauseAst,
} from './when-clause.js';
export {
  parseWhenClause,
  evaluateWhenClause,
  evalAst,
  MAX_EXPR_LENGTH as WHEN_CLAUSE_MAX_LENGTH,
  MAX_PAREN_DEPTH as WHEN_CLAUSE_MAX_DEPTH,
} from './when-clause.js';

export { bootstrapInputCore, __resetBootstrapFlagForTests } from './bootstrap.js';

export {
  armChordLeader,
  consumeChordContinuation,
  isChordArmed as isInputCoreChordArmed,
  disarmChordLeader,
  __resetChordStateForTests,
} from './chord-state.js';

export type {
  RawUserBinding,
  RawUserConfig,
  LoadReport,
  LoadReporter,
} from './user-config-loader.js';
export {
  resolveUserBindingsPath,
  loadUserBindings,
  watchUserBindings,
  initUserBindings,
  SUPPORTED_VERSION as USER_CONFIG_VERSION,
} from './user-config-loader.js';

export type { InputSettings, SettingsApplyResult } from './settings.js';
export {
  getInputSettings,
  applyInputSettings,
  resetInputSettings,
  __resetInputSettingsForTests,
} from './settings.js';

export type { AuditEntry, AuditTailOpts, AuditTailResult } from './audit-tail.js';
export {
  readAuditTail,
  isInputAuditEntry,
  formatAuditEntry,
  parseDuration,
} from './audit-tail.js';

export type { RebindLine, RebindOutcome } from './rebind-commands.js';
export { runRebindCommand } from './rebind-commands.js';

export type { Mode, ModeId } from './mode.js';
export {
  registerMode,
  getMode,
  listModes,
  activeMode,
  setMode,
  registerBuiltInModes,
  __resetModeManagerForTests,
} from './mode.js';
