// F-B1 — Public exports for the scenario harness layer.
//
// Import sites use this barrel so follow-ups (F-B2 live integration,
// IDX-7 expanded scenarios) reference a stable surface. Internal
// modules (`runner.ts`, `types.ts`, `fake-harness.ts`) stay
// rearrangeable without churning every consumer.

export type {
  Scenario,
  ScenarioSetup,
  ScenarioStep,
  ScenarioStatus,
  ScenarioResult,
  StepResult,
  StepStatus,
  MountSpec,
  DialogMountProps,
  ButtonMountProps,
  SelectMountProps,
  TextMountProps,
  ClickStep,
  ClickTarget,
  KeyStep,
  ExpectStep,
  ExpectTarget,
  ThemeStep,
  ContextKeyStep,
  DismissStep,
  WaitStep,
  PlaygroundHarness,
} from './types.js';

export { runScenario } from './runner.js';
export { createFakeHarness, type FakeEvent, type FakeHarnessState } from './fake-harness.js';

// F-B2 exports
export { ScenarioRegistry, getDefaultScenarioRegistry, _resetDefaultScenarioRegistryForTests } from './registry.js';
export { createLivePlaygroundHarness, type LiveHarnessDeps } from './live-harness.js';
export { buildSurfaceForMountSpec } from './mount-builder.js';
export { createPlaygroundCommandHandler, type PlaygroundCommandDeps } from './command.js';
export {
  DEFAULT_SCENARIOS,
  DIALOG_CONFIRM_FLOW,
  PICKER_ROW_CLICK_FLOW,
  THEME_SWITCH_CONTEXT_KEYS,
} from './default-scenarios.js';

// F-B4 exports
export {
  parseScenarioYaml,
  type ScenarioParseResult,
  type ParseError,
  type ParseWarning,
} from './yaml-parser.js';

// F-B5a exports
export { serializeScenarioToYaml } from './yaml-serializer.js';
export {
  PlaybackController,
  type PlaybackState,
  type PlaybackControllerOptions,
  type PlaybackTimer,
} from './playback-controller.js';
export {
  ReactiveScenarioEditor,
  type ReactiveEditorOptions,
  type ReactiveEditorTimer,
} from './reactive-editor.js';
