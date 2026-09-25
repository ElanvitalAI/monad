// InputEvent — canonical envelope that unifies keyboard + mouse for
// the policy resolver (./resolver.ts when it lands in Phase 2).
//
// Design goal: one event type reaches the resolver, but the underlying
// Key / DisplayMouseEvent keep their separate shapes so existing
// widget handlers stay unchanged. `toMatcher()` produces a tmux-style
// string keycode ("ctrl+b", "click:pane-title", …) that indexes the
// binding table.
//
// References informing this design:
//   - tmux `key-bindings.c` — mouse events as named keycodes routed
//     through the same table as keys.
//   - ghostty `src/input/key.zig` — canonical KeyEvent shape with
//     modifier set (shift, ctrl, alt, super).
//   - claude-code-fork `src/keybindings/*` — user-editable matcher
//     strings of the form "ctrl+shift+k".

import type { Key } from '../tui.js';

/** Mouse hit-target tags. The hit-tester (Phase 3) annotates the
 *  raw mouse event with which UI element the pointer is over, so
 *  bindings can say "click on pane-title" instead of "click at row X".
 *  Tagged union so TypeScript narrows cleanly at use sites. */
export type HitTarget =
  | { kind: 'pill'; name: string }
  | { kind: 'pane-nav-tab'; paneId: string }
  | { kind: 'pane-title'; paneId: string; widgetInstanceId?: string }
  | { kind: 'pane-body'; paneId: string; widgetInstanceId?: string }
  | { kind: 'status-bar' }
  | { kind: 'vw-pane-title'; windowId: number; paneId: string }
  | { kind: 'vw-pane-body'; windowId: number; paneId: string }
  // DS-3a preflight (PLAN-hittarget-input-kind-extension.md) — mirror
  // of display `{kind:'input', inputId}`. Text-input widgets (chat
  // composer etc.) get exact translation.
  | { kind: 'input'; inputId: string }
  // Option α.2 (PLAN-option-alpha-inputcore-slice §2 α.2) — mirror of
  // display `{kind:'modal-body', modalId}` and `{kind:'modal-button',
  // modalId, buttonId}`. Prior to α.2 these downgraded to
  // `{kind:'unknown'}` via `mouse-bridge.translateHitTarget` · matcher
  // grammar produced only `click:unknown` · binding table could not
  // scope to a specific modal. α.2 restored exact translation so:
  //   click:modal-body.modal::confirm       → specific
  //   click:modal-body                      → generic (cascade)
  //   right-click:modal-button.modal::approve:accept
  //   right-click:modal-button              → generic
  // `modalId` uses the display-layer `SurfaceId` brand · stringified
  // at the translate boundary so input-core stays independent of the
  // brand machinery.
  | { kind: 'modal-body'; modalId: string }
  | { kind: 'modal-button'; modalId: string; buttonId: string }
  | { kind: 'unknown' };

export interface KeyInputEvent {
  kind: 'key';
  key: Key;
}

export interface MouseInputEvent {
  kind: 'mouse';
  type:
    | 'click'
    | 'double-click'
    | 'right-click'
    | 'scroll-up'
    | 'scroll-down'
    | 'drag'
    | 'release'
    // IDX-5 Phase 1 — hover variants. These typically do NOT produce
    // matchers that bindings fire on (hover is a UI-local concept
    // consumed by the hover-tracker); including them in the type
    // keeps the event envelope uniform so the tracker can receive
    // the same shape the resolver does.
    | 'hover-enter'
    | 'hover-leave'
    | 'hover-over'
    | 'hover-stable';
  row: number;
  col: number;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  target: HitTarget;
}

export type InputEvent = KeyInputEvent | MouseInputEvent;

/** Build a KeyInputEvent from a raw Key. Cheap, allocation-free on
 *  hot path modulo the wrapper object. */
export function keyEvent(k: Key): KeyInputEvent {
  return { kind: 'key', key: k };
}

/** Canonical matcher string. Form:
 *    key:        [ctrl+][shift+][alt+]<name>     e.g. "ctrl+shift+t"
 *    named key:  escape | enter | tab | space | backspace | arrow-* | …
 *    plain char: lowercased single letter ("a", "s")
 *    mouse:      <type>:<target>[.<detail>]       e.g. "click:pill.model"
 *
 *  Always lowercased so the binding table is case-insensitive. Plain
 *  letters receive no ctrl/shift decoration unless a modifier is
 *  actually present (shift+a is NOT emitted for uppercase A, because
 *  the Key.shift bit only fires when the terminal reports it).
 *
 *  Callers pass the OUTPUT of this function as-is to binding-table
 *  lookups AND to SetInputBinding's `keys` argument — a single
 *  grammar in both directions keeps the docs honest. */
export function toMatcher(ev: InputEvent): string {
  if (ev.kind === 'key') {
    const k = ev.key;
    const parts: string[] = [];
    if (k.ctrl) parts.push('ctrl');
    if (k.shift && k.name.length > 1) parts.push('shift');  // plain letters skip shift
    const name = canonicalKeyName(k.name);
    parts.push(name);
    return parts.join('+').toLowerCase();
  }
  // Mouse events: <type>:<target-kind>[.<detail>]
  const type = ev.type;
  const t = ev.target;
  const detail = targetDetail(t);
  const base = `${type}:${t.kind}${detail ? `.${detail}` : ''}`;
  const mods: string[] = [];
  if (ev.ctrl) mods.push('ctrl');
  if (ev.shift) mods.push('shift');
  if (ev.alt) mods.push('alt');
  return (mods.length > 0 ? `${mods.join('+')}+${base}` : base).toLowerCase();
}

function canonicalKeyName(raw: string): string {
  // Normalize a few terminal quirks.
  if (raw === '\x1b') return 'escape';
  if (raw === '\r' || raw === '\n') return 'enter';
  if (raw === '\t') return 'tab';
  if (raw === ' ') return 'space';
  return raw;
}

function targetDetail(t: HitTarget): string | null {
  switch (t.kind) {
    case 'pill':          return t.name;
    case 'pane-nav-tab':  return t.paneId;
    case 'pane-title':    return t.paneId;
    case 'pane-body':     return t.paneId;
    case 'vw-pane-title': return `${t.windowId}.${t.paneId}`;
    case 'vw-pane-body':  return `${t.windowId}.${t.paneId}`;
    case 'input':         return t.inputId;
    case 'modal-body':    return t.modalId;
    case 'modal-button':  return `${t.modalId}:${t.buttonId}`;
    case 'status-bar':    return null;
    case 'unknown':       return null;
  }
  // Compile-time exhaustiveness guard · adding a new HitTarget kind
  // in `src/input-core/event.ts` without updating this switch
  // triggers a TS2322 at the assignment below.
  return assertNeverHitTarget(t);
}

function assertNeverHitTarget(t: never): never {
  throw new Error(`unreachable HitTarget kind: ${JSON.stringify(t)}`);
}

/** Produce ALL matcher strings an event could match, most-specific
 *  first. Lets bindings be declared generically ("click:pill") or
 *  specifically ("click:pill.model") — the resolver picks the first
 *  that has a binding.
 *
 *  Example returns for a click on the model pill:
 *    ["click:pill.model", "click:pill"]
 *
 *  Key events currently return a single matcher (no cascade). Mouse
 *  events cascade from <type:kind.detail> down to <type:kind>. */
export function matcherCascade(ev: InputEvent): string[] {
  if (ev.kind === 'key') return [toMatcher(ev)];
  const specific = toMatcher(ev);
  const t = ev.target;
  // Strip the ".<detail>" suffix for the generic tier.
  const mods: string[] = [];
  if (ev.ctrl) mods.push('ctrl');
  if (ev.shift) mods.push('shift');
  if (ev.alt) mods.push('alt');
  const base = `${ev.type}:${t.kind}`;
  const generic = (mods.length > 0 ? `${mods.join('+')}+${base}` : base).toLowerCase();
  return specific === generic ? [specific] : [specific, generic];
}
