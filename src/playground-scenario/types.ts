// F-B1 — Playground scenario schema types.
//
// Declarative test harness for the display layer. A Scenario is a
// sequence of steps (mount, click, key, expect, theme-switch, …)
// executed against a `PlaygroundHarness` abstraction. The harness
// is injected so:
//   • Unit tests use a `FakeHarness` (no real terminal required).
//   • F-B2 wires a `LiveHarness` into the existing View 7
//     (playground-widget) for manual interactive runs.
//   • IDX-7 expansion prototypes can register scenarios against
//     fixtures before the real feature code is written.
//
// Scenarios are ordinary TypeScript modules (no YAML parser
// dependency). `.ts` over `.yaml` keeps type-safety, IDE
// autocomplete, and cross-references to `LayoutSpec` / `HitTarget`
// / `KeyEvent` / `ContextKeys` working out of the box. Future
// loader layers (JSON/YAML) can convert to this shape without
// changing the runner.

import type { ContextKeys } from '../input-core/context-keys.js';
import type { HitTarget } from '../display/types.js';
import type { LayoutSpec } from '../display/layout-spec.js';
import type { KeyEvent } from '../plugins/core/types.js';

// ── Scenario + setup ────────────────────────────────────────────

export interface Scenario {
  /** Stable machine id — used for filtering + logging. Must be
   *  unique within the scenario registry. */
  id: string;
  /** Short human label shown in the playground UI. */
  title: string;
  /** Optional long-form explanation. Freeform markdown-ish; the
   *  runner doesn't parse it. */
  description?: string;
  /** Optional one-shot initialization — theme, pre-mounted
   *  components. Runs before the first step. */
  setup?: ScenarioSetup;
  /** Ordered step list. Execution stops at the first failing
   *  step; subsequent steps are left unrun. */
  steps: ScenarioStep[];
  /** Tags for filtering (`tablet`, `picker`, `pane-nav`, etc.).
   *  Runner ignores them; F-B2 UI uses them to group scenarios. */
  tags?: string[];
}

export interface ScenarioSetup {
  /** Theme id — applied via `harness.setTheme` before step 0. */
  theme?: string;
  /** Components to mount up front. Each entry runs through
   *  `harness.mount`. */
  mount?: MountSpec[];
  /** Context-key presets. Useful for scenarios that assume a
   *  specific `focusMode` / `dialogOpen` baseline. */
  contextKeys?: Partial<ContextKeys>;
}

// ── Mount + component references ────────────────────────────────

/** Discriminated union describing a component to spawn in the
 *  playground stage. `kind` names a component family the harness
 *  knows how to build; `props` is opaque configuration forwarded
 *  unchanged. Extend the union when the playground catalogue
 *  grows a new widget. */
export type MountSpec =
  | { id: string; kind: 'dialog'; props: DialogMountProps; layout?: LayoutSpec }
  | { id: string; kind: 'button'; props: ButtonMountProps; layout?: LayoutSpec }
  | { id: string; kind: 'select'; props: SelectMountProps; layout?: LayoutSpec }
  | { id: string; kind: 'text'; props: TextMountProps; layout?: LayoutSpec }
  | { id: string; kind: 'custom'; props: Record<string, unknown>; layout?: LayoutSpec };

export interface DialogMountProps {
  title: string;
  body?: string;
  buttons: Array<{ value: string; label: string; buttonId?: string }>;
}

export interface ButtonMountProps {
  label: string;
  buttonId?: string;
  onClickId?: string;   // string name the scenario expects fired (harness records clicks)
}

export interface SelectMountProps {
  options: Array<{ value: string; label: string }>;
  initialCursor?: number;
}

export interface TextMountProps {
  text: string;
}

// ── Steps ────────────────────────────────────────────────────────

export type ScenarioStep =
  | ClickStep
  | KeyStep
  | ExpectStep
  | ThemeStep
  | ContextKeyStep
  | DismissStep
  | WaitStep;

export interface ClickStep {
  action: 'click';
  /** What to click. `component` resolves by mounted id; `hit` uses
   *  a fully-qualified `HitTarget`; `coords` targets a raw
   *  terminal (row, col). */
  target: ClickTarget;
  /** Modifier mimicking a middle / right-click. Default 'left'. */
  button?: 'left' | 'right' | 'double';
}

export type ClickTarget =
  | { kind: 'component'; componentId: string; subId?: string }
  | { kind: 'hit'; hitTarget: HitTarget }
  | { kind: 'coords'; row: number; col: number };

export interface KeyStep {
  action: 'key';
  event: KeyEvent;
}

export interface ExpectStep {
  action: 'expect';
  target: ExpectTarget;
  /** Optional descriptive note rendered when the assertion fails.
   *  Useful for multi-step scenarios where the literal assertion
   *  is terse. */
  message?: string;
}

/** Built-in expect targets. Runner resolves each via the harness
 *  API: context-key reads `getContextKey`, modal-mounted walks
 *  the modal stack, render-contains queries the last-rendered
 *  ANSI string. Extend this union as scenarios reveal gaps —
 *  every new target shape has a one-line runner branch. */
export type ExpectTarget =
  | { kind: 'context-key'; key: keyof ContextKeys; value: unknown }
  | { kind: 'modal-mounted'; id: string }
  | { kind: 'modal-dismissed'; id: string }
  | { kind: 'modal-stack-length'; length: number }
  | { kind: 'last-clicked'; componentId: string }
  | { kind: 'render-contains'; substring: string }
  | { kind: 'no-unexpected-error' };

export interface ThemeStep {
  action: 'theme';
  name: string;
}

export interface ContextKeyStep {
  action: 'set-context-key';
  key: keyof ContextKeys;
  value: unknown;
}

export interface DismissStep {
  action: 'dismiss';
  /** Dismiss the topmost modal (shortcut for keying Escape + asserting). */
  modalId?: string;
}

export interface WaitStep {
  action: 'wait';
  /** Milliseconds to await — used when a step schedules an async
   *  follow-up (coordinator frame batch, picker filesystem scan). */
  ms: number;
}

// ── Runner results ───────────────────────────────────────────────

export type StepStatus = 'pass' | 'fail' | 'skipped' | 'error';

export interface StepResult {
  step: ScenarioStep;
  status: StepStatus;
  /** Populated on fail/error — the assertion message OR the
   *  thrown exception stringified. */
  message?: string;
  /** Actual observed value on fail, when applicable. */
  actual?: unknown;
  /** Step duration in ms — handy for regressions where the
   *  scenario slows down without failing. */
  durationMs: number;
}

export type ScenarioStatus = 'pass' | 'fail' | 'error';

export interface ScenarioResult {
  scenario: Scenario;
  status: ScenarioStatus;
  stepResults: StepResult[];
  /** Total scenario duration in ms (sum of step durations + setup
   *  overhead). */
  durationMs: number;
}

// ── Harness contract ────────────────────────────────────────────

/** Abstraction the runner drives. Unit tests implement this as a
 *  plain object (`FakeHarness`). F-B2's live integration
 *  implements it against the real DisplayCoordinator +
 *  playground-widget. */
export interface PlaygroundHarness {
  mount(spec: MountSpec): void;
  dismiss(modalId?: string): void;
  click(target: ClickTarget, button: 'left' | 'right' | 'double'): void;
  key(event: KeyEvent): void;
  setTheme(name: string): void;
  setContextKey<K extends keyof ContextKeys>(key: K, value: ContextKeys[K]): void;

  // Query helpers — scenarios assert against these.
  getContextKey<K extends keyof ContextKeys>(key: K): ContextKeys[K] | undefined;
  getModalStack(): string[];
  getLastClickedComponentId(): string | null;
  getLastRender(): string;

  /** Await pending frames / async dispatches. Runner calls this
   *  on every WaitStep. Harness implementations may no-op when
   *  their internal queue is empty. */
  waitFor(ms: number): Promise<void>;
}
