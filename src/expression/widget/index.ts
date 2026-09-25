// Public surface for `src/expression/widget/`. Foundation for the
// framework's bidirectional interaction substrate (PLAN-tui-
// expression-framework-2026-04-28.md §1.4').

export {
  type ModalSessionState,
  type ModalSessionEvent,
  type ModalSessionSnapshot,
  INITIAL_SNAPSHOT,
  transition,
  run as runStateMachine,
} from './state-machine.js';

export {
  type ModalKey,
  type ModalKeyAction,
  routeInteractiveModalKey,
} from './key-route.js';

export {
  type ReadlineEvent,
  type ReadlineListener,
  type ReadlineHost,
  type TestReadlineHost,
  type NodeReadlineHostOptions,
  createTestReadlineHost,
  createNodeReadlineHost,
} from './readline-host.js';

export {
  type InteractiveModalLifecycle,
  type InteractiveModalProgress,
  type InteractiveModalRunOpts,
  type InteractiveModalResult,
  runInteractiveModalSession,
} from './interactive-modal.js';

// LT 6 (PR-15) · bidirectional integrations — re-export the
// domain-specific adapters so callers can `import { ... } from
// 'src/expression/widget'` instead of reaching into the adapters/
// subdir. Pure functions, no IO.
export {
  askUserRequestToInteractiveModalSpec,
  interactiveModalResultToAnswer,
  hitlConfirmRequestToInteractiveModalSpec,
  interactiveModalResultToHitlConfirm,
  createWidgetAskUserResolver,
  createWidgetHitlChannel,
  OTHER_LABEL,
  OTHER_TEXT_FIELD_SUFFIX,
  type AskUserAdapterOpts,
  type HitlConfirmAdapterOpts,
  type CreateWidgetAskUserResolverOpts,
  type CreateWidgetHitlChannelOpts,
} from './adapters/index.js';
