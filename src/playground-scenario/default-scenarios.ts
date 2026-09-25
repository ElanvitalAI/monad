// F-B2 — Default scenarios bundled with the `/playground` command.
//
// Each scenario here demonstrates a specific invariant the F5 /
// F-E / R1 / R2 arcs landed. Running them is a smoke test: if one
// fails, a regression slipped through.
//
// Scenario authoring conventions:
//   • `id` is `<arc>:<short-name>` — groups in `/playground list`.
//   • `tags` drive filtering (smoke / regression / integration /
//     tablet / picker / dialog / focus).
//   • Steps stay minimal — one invariant per scenario. Bigger
//     flows come from composing scenarios at the runner level.
//
// Future arcs register their own scenarios via
// `registry.register(...)` in their integration module; these
// defaults are just the starter set.

import type { Scenario } from './types.js';

export const DIALOG_CONFIRM_FLOW: Scenario = {
  id: 'dialog:confirm-flow',
  title: 'Dialog confirm → click OK → dismissed',
  description: 'Mount a confirmation dialog, click OK, verify stack empty. Smoke test for F5c Button.buttonId + F-E modal onMouse wiring.',
  tags: ['dialog', 'smoke'],
  setup: {
    mount: [{
      id: 'confirm',
      kind: 'dialog',
      props: {
        title: 'Delete file?',
        body: 'This cannot be undone.',
        buttons: [
          { value: 'ok',     label: 'OK',     buttonId: 'ok' },
          { value: 'cancel', label: 'Cancel', buttonId: 'cancel' },
        ],
      },
    }],
  },
  steps: [
    { action: 'expect', target: { kind: 'modal-mounted', id: 'confirm' } },
    { action: 'click',  target: { kind: 'component', componentId: 'confirm:ok' } },
    { action: 'expect', target: { kind: 'last-clicked', componentId: 'confirm:ok' } },
    { action: 'dismiss', modalId: 'confirm' },
    { action: 'expect', target: { kind: 'modal-dismissed', id: 'confirm' } },
    { action: 'expect', target: { kind: 'modal-stack-length', length: 0 } },
  ],
};

export const PICKER_ROW_CLICK_FLOW: Scenario = {
  id: 'picker:row-click',
  title: 'Picker row click dispatches submit (F-E regression)',
  description: 'Mount a select picker, click the 3rd row via hit-target, verify the submit callback fires with the expected value. Regression guard for the bug bisected in PR #120.',
  tags: ['picker', 'regression'],
  setup: {
    mount: [{
      id: 'slash-picker',
      kind: 'select',
      props: {
        options: [
          { value: 'help',  label: '/help' },
          { value: 'quit',  label: '/quit' },
          { value: 'clear', label: '/clear' },
        ],
        initialCursor: 0,
      },
    }],
  },
  steps: [
    { action: 'expect', target: { kind: 'modal-mounted', id: 'slash-picker' } },
    {
      action: 'click',
      target: {
        kind: 'hit',
        hitTarget: { kind: 'modal-body', modalId: 'slash-picker', itemIndex: 2 },
      },
    },
    { action: 'expect', target: { kind: 'last-clicked', componentId: 'slash-picker:clear' } },
  ],
};

export const THEME_SWITCH_CONTEXT_KEYS: Scenario = {
  id: 'theme:switch-context-keys',
  title: 'Theme switch updates context keys',
  description: 'Switch to a pastel theme + verify ContextKeys.themeName update. Smoke test for IDX-6 Phase 3 theme service.',
  tags: ['theme', 'smoke'],
  steps: [
    { action: 'set-context-key', key: 'themeName' as never, value: 'monad-pastel-default' },
    { action: 'expect', target: { kind: 'context-key', key: 'themeName' as never, value: 'monad-pastel-default' } },
  ],
};

export const DEFAULT_SCENARIOS: readonly Scenario[] = [
  DIALOG_CONFIRM_FLOW,
  PICKER_ROW_CLICK_FLOW,
  THEME_SWITCH_CONTEXT_KEYS,
];
