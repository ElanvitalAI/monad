// Navigation router — VW-P7.
//
// Tmux-inspired prefix chord (Ctrl+B + sequence) for window/pane
// control. The dashboard wires this router as a peer to the
// existing terminalModalRouter (VW router takes precedence when a
// virtual window is foreground).
//
// Prefix table (active while chord.armed === true):
//
//   Ctrl+1..9, 1..9  → switch to window N
//   0                → open window picker modal
//   n                → next window
//   p                → previous window
//   c                → new window (spawn default terminal)
//   x                → close focused pane
//   X                → close foreground window
//   "                → split focused pane vertically (stacked)
//   %                → split focused pane horizontally (side-by-side)
//   z                → (planned) toggle pane zoom
//   arrows / h/j/k/l → focus pane directionally
//   ?                → help overlay (listed ops)
//
// All prefix keys are swallowed; they never reach the foreground
// pane content. When chord is NOT armed, every key passes through
// to the focused pane.

import type { KeyEvent } from '../display/types.js';
import type { WindowRegistry } from './window-registry.js';
import type { Direction } from './layout-tree.js';

export type NavResult =
  | 'passthrough'   // no chord state involved; caller forwards to pane
  | 'armed'         // prefix captured; waiting for sequence key
  | 'consumed'      // sequence key handled; chord disarms
  | 'cancelled';    // chord disarmed due to invalid key

export interface NavCallbacks {
  /** Called when prefix+c requests a new window. Caller decides
   *  content (usually a terminal shell). */
  onNewWindow?: () => void;
  /** Called when prefix+0 requests the picker modal. */
  onPicker?: () => void;
  /** Called when prefix+? — typically render a help overlay. */
  onHelp?: () => void;
  /** Called when prefix+X wants to close the foreground window. */
  onCloseWindow?: () => void;
  /** Called for prefix+% / prefix+" — split with default content
   *  factory (usually a terminal). */
  onSplit?: (axis: 'h' | 'v') => void;
  /** Phase α2 — called for prefix+t to toggle between the foreground
   *  virtual window and the most recent terminal-session modal. The
   *  caller owns the "which modal" and "does adopt succeed" logic. */
  onModalWindowToggle?: () => void;
  /** Phase T3b-c — prefix+I toggles the per-VW sync input bar.
   *  Host implementation calls `window.setSyncInputBar(!active)`
   *  on the current foreground window; router doesn't touch VW
   *  state directly so it stays UI-layer agnostic. */
  onSyncInputBarToggle?: () => void;
  /** VW-U5 — prefix+z toggles pane zoom on the focused pane of the
   *  current VW. Host calls `window.toggleZoom()` + redraws. */
  onZoomToggle?: () => void;
  /** VW-U5 — prefix+Tab jumps focus to the pane that was focused
   *  before the current one (alt-tab feel). Host calls
   *  `window.focusLastPane()` + redraws. */
  onLastFocusedPane?: () => void;
  /** VW-B1 — prefix+R renames the current foreground window. Host
   *  opens an input modal and calls `registry.renameWindow(id, next)`
   *  on submit. (Mapped to Shift+R, not `,` — `,` is the prev-window
   *  alias and conflicts with the tmux convention of `^B ,`.) */
  onRenameWindow?: () => void;
  /** VW-B2 — prefix+Shift+A renames the focused pane via a VW-owned
   *  display-title override (PaneContent.title stays canonical). */
  onRenamePane?: () => void;
}

export interface NavigationRouter {
  /** Feed a raw key event. Returns the routing verdict. */
  handleKey(ev: KeyEvent): NavResult;
  /** True while prefix chord is armed. */
  isArmed(): boolean;
  /** Force-disarm (used when foreground context changes). */
  reset(): void;
  /** FU-2 — dispatch a body key as if we were already armed, without
   *  requiring handleKey's own arm state. Used by the DisplayCoordinator
   *  chord port where arming is owned by the coordinator and the body
   *  key is delivered via registerKeyBinding({chordPrefix, key, handler}).
   *  The handler synthesises a KeyEvent that matches the binding and
   *  forwards to this method — one body-dispatch codepath, still
   *  hosted inside NavigationRouter, so imperative callers and
   *  coordinator-driven callers agree on behaviour. */
  dispatchArmed(ev: KeyEvent): NavResult;
}

export interface NavigationDeps {
  registry: WindowRegistry;
  callbacks?: NavCallbacks;
  /** Chord timeout in ms. Default 1000. */
  chordTimeoutMs?: number;
  /** Override Date.now for deterministic tests. */
  now?: () => number;
}

export const PREFIX_KEY = 'b';

export function createNavigationRouter(deps: NavigationDeps): NavigationRouter {
  let armed = false;
  let armedAt = 0;
  const timeout = deps.chordTimeoutMs ?? 1000;
  const now = deps.now ?? (() => Date.now());

  const isPrefix = (ev: KeyEvent): boolean => {
    const n = (ev.name ?? '').toLowerCase();
    return !!ev.ctrl && (n === PREFIX_KEY || n === 'ㅠ'); // Korean IME
  };

  const reset = (): void => { armed = false; armedAt = 0; };

  const handleKey = (ev: KeyEvent): NavResult => {
    // Chord timeout — auto-disarm if too long since arm.
    if (armed && (now() - armedAt) > timeout) reset();

    if (!armed) {
      if (isPrefix(ev)) {
        armed = true;
        armedAt = now();
        return 'armed';
      }
      return 'passthrough';
    }

    // Armed — consume one sequence key.
    armed = false;
    const result = dispatch(ev);
    return result;
  };

  const dispatch = (ev: KeyEvent): NavResult => {
    const name = (ev.name ?? '').toLowerCase();

    // Digit: switch to window N.
    if (/^[0-9]$/.test(name)) {
      const n = parseInt(name, 10);
      if (n === 0) {
        deps.callbacks?.onPicker?.();
        return 'consumed';
      }
      const windows = deps.registry.list().sort((a, b) => a.id - b.id);
      const target = windows[n - 1];
      if (target) deps.registry.switchTo(target.id);
      return 'consumed';
    }

    // Ctrl+1..9 also switches (users who hold ctrl through the chord).
    if (ev.ctrl && /^[1-9]$/.test(name)) {
      const n = parseInt(name, 10);
      const windows = deps.registry.list().sort((a, b) => a.id - b.id);
      const target = windows[n - 1];
      if (target) deps.registry.switchTo(target.id);
      return 'consumed';
    }

    switch (name) {
      case 'n': deps.registry.next(); return 'consumed';
      case 'p': deps.registry.previous(); return 'consumed';
      // Phase α2 — angle-bracket aliases for prev/next. Matches the
      // user-asked "Ctrl+B Ctrl+<" for previous window; on TTY the
      // literal Ctrl+< usually surfaces as just '<' after the chord
      // so we accept both bare and ctrl-qualified variants.
      case '<': case ',': deps.registry.previous(); return 'consumed';
      case '>': case '.': deps.registry.next(); return 'consumed';
      case 'c':
        deps.callbacks?.onNewWindow?.();
        return 'consumed';
      case 't':
        // Phase α2 — modal ↔ VW toggle. Callback owns the adopt
        // logic; router just dispatches.
        deps.callbacks?.onModalWindowToggle?.();
        return 'consumed';
      case 'x': {
        // FU-2 — Shift+X was supposed to close the whole window via
        // the default branch below, but the case 'x' grabbed both
        // variants first. Branch on ev.shift here so the semantics
        // match the help popup ("x=close pane, X=close win").
        if (ev.shift) {
          deps.callbacks?.onCloseWindow?.();
          return 'consumed';
        }
        const w = deps.registry.current();
        if (w) w.closeFocused();
        return 'consumed';
      }
      case '%':
      case 's':   // horizontal shortcut ("side-by-side")
        deps.callbacks?.onSplit?.('h');
        return 'consumed';
      case '"':
      case 'v':   // vertical shortcut ("vertical stack")
        deps.callbacks?.onSplit?.('v');
        return 'consumed';
      case '?':
        deps.callbacks?.onHelp?.();
        return 'consumed';
      case 'i': // ㅑ maps to i via KOREAN_TO_EN
        deps.callbacks?.onSyncInputBarToggle?.();
        return 'consumed';
      case 'z':
        deps.callbacks?.onZoomToggle?.();
        return 'consumed';
      case 'tab':
        deps.callbacks?.onLastFocusedPane?.();
        return 'consumed';
      case 'r':
        // VW-B1 — `r` fires rename-window. `R` (Shift+r) is the form
        // the help popup advertises; both dispatch through here.
        deps.callbacks?.onRenameWindow?.();
        return 'consumed';
      case 'a':
        // VW-B2 — `A` (Shift+a) fires rename-pane. Lowercased on
        // dispatch by the coordinator; Shift bit is carried along the
        // chord-body match but we don't inspect it here.
        deps.callbacks?.onRenamePane?.();
        return 'consumed';
      case 'up':    focusDir(deps.registry, 'up'); return 'consumed';
      case 'down':  focusDir(deps.registry, 'down'); return 'consumed';
      case 'left':  focusDir(deps.registry, 'left'); return 'consumed';
      case 'right': focusDir(deps.registry, 'right'); return 'consumed';
      case 'h':     focusDir(deps.registry, 'left'); return 'consumed';
      case 'j':     focusDir(deps.registry, 'down'); return 'consumed';
      case 'k':     focusDir(deps.registry, 'up'); return 'consumed';
      case 'l':     focusDir(deps.registry, 'right'); return 'consumed';
      default: {
        // FU-2 — Shift+X moved into `case 'x':` above; default branch
        // now only handles unknown keys.
        return 'cancelled';
      }
    }
  };

  return {
    handleKey,
    isArmed: () => armed,
    reset,
    dispatchArmed: (ev: KeyEvent) => dispatch(ev),
  };
}

function focusDir(registry: WindowRegistry, dir: Direction): void {
  const w = registry.current();
  if (!w) return;
  w.focusDirection(dir);
}
