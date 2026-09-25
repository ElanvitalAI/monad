// Declarative spec types — `kind`-tagged union consumed by renderers.
//
// Every screen / table / modal / status segment in the expression
// layer is reified as a partial spec. A spec is parsed once
// (frontmatter / TOML / inline object) and then fed into a pure
// renderer that translates `(spec, profile, theme)` → ANSI string.
//
// Rules:
//  - Specs are partial — any field can be omitted; renderers fall
//    back to layered defaults (Layer 1 framework default → Layer 2
//    theme preset → Layer 3 answer file → ...). Don't enforce
//    required fields here; that's the parser's job (spec/parse.ts
//    in the next mini-PR) and validate.ts's.
//  - `kind` is the discriminator. Cases match on `spec.kind`.
//  - Interaction specs (Step / Picker / Modal) point at `actions[]`
//    rather than reaching back into a host's command bus, so the
//    same spec can drive a CLI process path AND a dashboard widget
//    path (Principle #1 of the framework master plan).

import type { AdaptiveColor } from '../color.js';
import type { BorderKind } from '../borders.js';

// ── Shared atoms ────────────────────────────────────────────────────

export type StyleColor = AdaptiveColor | string;

export interface SpecStyle {
  fg?: StyleColor;
  bg?: StyleColor;
  bold?: boolean;
  faint?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface ActionSpec {
  id: string;
  label: string;
  /** Hotkey hint shown next to the label, e.g. `'Enter'` / `'b'`. */
  hotkey?: string;
  /** Conditional visibility — show this action only when the prior
   *  step results match the partial. */
  when?: Record<string, unknown>;
  primary?: boolean;
  destructive?: boolean;
}

export type FieldKind =
  | 'text'
  | 'secret'
  | 'confirm'
  | 'select'
  | 'number'
  | 'list-int'
  | 'list-string'
  | 'path';

export interface FieldSpec {
  id: string;
  kind: FieldKind;
  label: string;
  help?: string;
  placeholder?: string;
  /** Initial value — overridden by Layer 3+ answer file. */
  default?: unknown;
  required?: boolean;
  /** Conditional visibility per partial answers. */
  visible_when?: Record<string, unknown>;
  validate?: {
    pattern?: string;
    message?: string;
  };
  /** Options for `kind: 'select'`. */
  options?: ReadonlyArray<{ id: string; label: string; help?: string }>;
}

// ── Step (single-screen interactive) ────────────────────────────────

export interface StepSpec {
  kind: 'step';
  id: string;
  title: string;
  excerpt?: string;
  progress?: { index: number; total: number; bar?: 'solid' | 'gradient' | 'dotted' };
  fields: ReadonlyArray<FieldSpec>;
  actions?: ReadonlyArray<ActionSpec>;
  /** Schema version — bump when breaking changes land. Helps the
   *  parser route through migrations without crashing older specs. */
  schema_version?: number;
}

// ── Table (slash output / metrics) ──────────────────────────────────

export interface ColumnSpec {
  id: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  /** Width hint — pixels are not a thing in TTYs, so this is a
   *  cell budget. Omit to let the renderer compute from data. */
  width?: number;
  format?: 'text' | 'number' | 'percent' | 'duration' | 'bytes';
  style?: SpecStyle;
}

export interface TableSpec {
  kind: 'table';
  id?: string;
  title?: string;
  columns: ReadonlyArray<ColumnSpec>;
  rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  style?: {
    border?: BorderKind;
    header?: SpecStyle;
    row_striped?: boolean;
  };
  schema_version?: number;
}

// ── Markdown (/help · /research) ────────────────────────────────────

export interface MarkdownSpec {
  kind: 'markdown';
  id?: string;
  title?: string;
  /** Raw markdown source. Either `body` or `path` is required at
   *  parse time — both make `body` win. */
  body?: string;
  path?: string;
  /** Theme override; defaults to the active theme's markdown variant. */
  theme?: string;
  schema_version?: number;
}

// ── Modal (notification · dialog) ───────────────────────────────────

export interface ModalSpec {
  kind: 'modal';
  id: string;
  title: string;
  body: string;
  variant?: 'info' | 'success' | 'warning' | 'error' | 'destructive';
  actions?: ReadonlyArray<ActionSpec>;
  style?: {
    border?: BorderKind;
    accent?: SpecStyle;
  };
  schema_version?: number;
}

// ── Progress (gradient bar) ─────────────────────────────────────────

export interface ProgressSpec {
  kind: 'progress';
  id?: string;
  /** 0..1. Renderers clamp out-of-range values. */
  value: number;
  width?: number;
  bar?: 'solid' | 'gradient' | 'dotted';
  /** Optional gradient endpoints. When omitted the renderer derives
   *  from theme tokens (accent → highlight). */
  from?: StyleColor;
  to?: StyleColor;
  /** Right-aligned label, e.g. `"42%"` or `"3 / 7"`. */
  label?: string;
  schema_version?: number;
}

// ── Spinner (async hint) ────────────────────────────────────────────

export interface SpinnerSpec {
  kind: 'spinner';
  id?: string;
  style?: 'dots' | 'line' | 'arc' | 'pulse' | 'bounce';
  label?: string;
  /** Frame index. Renderers are pure, so the host advances this
   *  externally and re-renders. */
  frame?: number;
  schema_version?: number;
}

// ── Picker (provider / model / skill list) ──────────────────────────

export interface PickerItemSpec {
  id: string;
  label: string;
  description?: string;
  hint?: string;
  disabled?: boolean;
  disabled_reason?: string;
}

export interface PickerSpec {
  kind: 'picker';
  id: string;
  title?: string;
  items: ReadonlyArray<PickerItemSpec>;
  /** Cursor index. */
  cursor?: number;
  /** Fuzzy filter input. Empty string = show all. */
  query?: string;
  /** Multi-select toggle — picker emits a Set instead of single id. */
  multi?: boolean;
  schema_version?: number;
}

// ── Status module (status bar segment) ──────────────────────────────

export interface StatusModuleSpec {
  kind: 'status-module';
  id: string;
  /** Logical layout slot. The status bar router decides ordering. */
  slot?: 'left' | 'center' | 'right';
  text: string;
  icon?: string;
  style?: SpecStyle;
  /** True when the module wants to advertise an action via tooltip /
   *  popup. Hosts wire this up; the spec just declares the intent. */
  actionable?: boolean;
  schema_version?: number;
}

// ── Interactive modal — Q&A chain widget ────────────────────────────
//
// The interactive modal is the framework's bidirectional substrate
// (Principle #5 of `PLAN-tui-expression-framework-2026-04-28.md` §1.4').
// One spec drives multiple call sites: setup wizard, ACP `ask-user-
// question`, HITL approval, LLM-prompt request, plugin confirm. Each
// step in the chain is a small structured prompt; results aggregate
// into a record keyed by `step.id`.

export interface ConfirmStepSpec {
  kind: 'confirm';
  id: string;
  label: string;
  help?: string;
  default?: boolean;
}

export interface TextStepSpec {
  kind: 'text';
  id: string;
  label: string;
  help?: string;
  placeholder?: string;
  secret?: boolean;
  default?: string;
  validate?: { pattern?: string; message?: string };
}

export interface PickerStepSpec {
  kind: 'pick';
  id: string;
  label: string;
  help?: string;
  items: ReadonlyArray<{ id: string; label: string; description?: string }>;
  default?: string;
  multi?: boolean;
}

export type InteractiveModalStep = ConfirmStepSpec | TextStepSpec | PickerStepSpec;

export interface InteractiveModalSpec {
  kind: 'interactive-modal';
  id: string;
  title: string;
  excerpt?: string;
  steps: ReadonlyArray<InteractiveModalStep>;
  /** Optional border / accent overrides — falls back to theme tokens. */
  style?: ModalSpec['style'];
  schema_version?: number;
}

// ── Discriminated union ─────────────────────────────────────────────

export type Spec =
  | StepSpec
  | TableSpec
  | MarkdownSpec
  | ModalSpec
  | ProgressSpec
  | SpinnerSpec
  | PickerSpec
  | StatusModuleSpec
  | InteractiveModalSpec;

export type SpecKind = Spec['kind'];

/** Narrow a Spec by kind in a way that satisfies TS without casts:
 *
 *    if (isKind(spec, 'table')) { spec.columns ... }
 */
export function isKind<K extends SpecKind>(
  spec: Spec,
  kind: K,
): spec is Extract<Spec, { kind: K }> {
  return spec.kind === kind;
}
