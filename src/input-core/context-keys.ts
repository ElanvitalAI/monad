import type { ModalTier } from '../display/types.js';
import type { SurfaceKind } from '../surface/address.js';

// ContextKeys — a reactive snapshot of "what state is the UI in?"
// consumed by the resolver's when-clause gate.
//
// Philosophy (borrowed from VSCode `IContextKeyService`
// `src/vs/platform/contextkey/common/contextkey.ts:2037-2080`):
//   - Keys are a flat object. Subscribers see every change.
//   - Equality-based change detection — update() that doesn't alter
//     any value is a no-op; subscribers don't fire. Event storms on
//     keystrokes (which can call update() many times per frame) are
//     structurally impossible.
//   - Pure data shape — no functions, no promises. Serializable for
//     LLM introspection (IDX-4 GetDisplayState).
//
// This module intentionally doesn't know about modal tiers or
// dashboard state. That wiring lives in the caller (see
// src/dashboard.ts integration in IDX-2b). Here we provide a pure
// service: get / update / subscribe / reset.

/** The flat snapshot shape. Extend with new keys; resolver when-clauses
 *  address them by identifier. All boolean keys default to `false`; all
 *  string keys default to `null` unless noted. Adding a key is
 *  backward-compatible (unknown keys in a when-clause evaluate to
 *  `undefined`, which is falsy). */
export interface ContextKeys {
  // ── Focus ──────────────────────────────────────────────────────
  /** Which logical surface family owns key focus. */
  focusMode: 'input' | 'pane' | 'modal' | 'terminal';
  /** When focusMode='pane', which pane. */
  activePaneId: string | null;

  // ── Modal stack (IDX-2b will wire modal lifecycle) ─────────────
  /** Top modal's tier tag · typed as the 8-kind `ModalTier` union
   *  from `src/display/types.ts` (option-α.1 · IDX-F1 ModalTier
   *  enum landed → input-core context-key 가 string 타입으로 느슨
   *  했던 legacy 승격). Publisher is `src/ui/modal-adapter.ts` ·
   *  이미 `spec.tier` (ModalTier) 값을 통과시키므로 runtime 변경
   *  없음 · 타입 안전성만 복원. Null when no modal is mounted. */
  modalTopTier: ModalTier | null;
  pickerOpen: boolean;
  popupOpen: boolean;
  dialogOpen: boolean;
  terminalModalActive: boolean;

  // ── Mode state ─────────────────────────────────────────────────
  planModeActive: boolean;
  /** @deprecated Always `false`. Sync was retired from `ModeManager`
   *  in Arc A (harness-engineering meta-track) — it is owned by the
   *  PluginHost (`pluginHost.activate('sync')`). The key is kept on
   *  the interface for compatibility with existing when-clauses; new
   *  consumers should use `pluginHost.isActive('sync')` for live
   *  state. */
  syncModeActive: boolean;
  controlModeActive: boolean;

  // ── PFC integration (optional; false when substrate absent) ────
  autoModeActive: boolean;
  budgetWarningActive: boolean;
  escalationPending: boolean;

  // ── IDX-5 Phase 1 — hover state ─────────────────────────────────
  /** HitTarget kind under the pointer after the stable-hover debounce
   *  fires. Null when the pointer is moving, off any hit region, or
   *  outside the terminal. Updated only on hover-stable + cleared on
   *  hover-leave per DD-IDX-17. */
  hoverTargetKind: string | null;
  /** Tooltip text attached to the stable hover target, or null if the
   *  target didn't declare tooltipText. Drives Tooltip widget auto-
   *  trigger (IDX-5 Phase 1). */
  hoverTooltip: string | null;

  // ── IDX-5 Phase 2 — context-menu state ─────────────────────────
  /** True while a right-click context menu is open and awaiting a
   *  pick or dismissal. When-clauses can use this to suppress other
   *  mouse/key bindings while the menu has focus. */
  contextMenuOpen: boolean;

  // ── IDX-5 Phase 3 — last click state ───────────────────────────
  /** Region kind of the most recent mouse click, or `null` when
   *  the last click fell on empty space. Values follow the same
   *  convention as `hoverTargetKind`. Current domain:
   *    - `'status-bar-pill'` — one of the status-bar pills (model,
   *      swd, mode, shells, vw, etc.)
   *    - `'pane-nav'` — the pane-nav tab strip row (e.g. the
   *      `[ Browser ] [ Preview ] ...` band)
   *    - `'pane-title'` — the first row of a pane cell (title bar)
   *    - `'pane-body'` — the non-title area of a pane cell
   *    - `null` — divider / hud / other whitespace
   *  Updated on every click / double-click / right-click event.
   *  Lets when-clauses / LLM introspection tools understand what
   *  the user just interacted with. Future: `'modal-body'` /
   *  `'modal-button'` / `'vw-pane-*'` land with IDX-3 HitTarget. */
  lastClickHitKind: string | null;

  // ── A-7a · HitTarget live projection ───────────────────────────
  /** Kind of the HitTarget under the most recent mouse event (click
   *  / scroll / drag / release / motion). Differs from
   *  `lastClickHitKind` (which is click-only and freezes between
   *  clicks) — this key updates on EVERY mouse event dispatched
   *  through `routeInputEvent`, so when-clauses can declaratively
   *  match live states like `"hitTargetKind == 'pane-body' &&
   *  viewModeKind == 'idle'"`.
   *
   *  Publisher: `publishMouseTargetToContextKeys` in
   *  `src/input-core/mouse-context-publisher.ts` — called from the
   *  dashboard input-core handler before `resolveInputEvent`.
   *
   *  Values: each concrete `HitTarget.kind` from
   *  `src/input-core/event.ts` (`'pill'` / `'pane-nav-tab'` /
   *  `'pane-title'` / `'pane-body'` / `'status-bar'` / `'vw-pane-
   *  title'` / `'vw-pane-body'` / `'input'` / `'unknown'`), or
   *  `null` before the first mouse event is observed.
   *
   *  DS-3a preflight — `'input'` added for text-input widget hits
   *  (chat composer etc.). Both matcher cascade
   *  (`click:input.<inputId>` / `click:input`) and when-clauses
   *  (`hitTargetKind == 'input' && hitTargetInputId == 'chat-main'`)
   *  can address specific inputs.
   *
   *  Option α.2 — `'modal-body'` / `'modal-button'` added. Mirrored
   *  from the display union (see `src/input-core/event.ts`
   *  HitTarget). Matcher cascade now produces
   *  `click:modal-body.<modalId>` / `click:modal-button.<modalId>:<buttonId>`
   *  instead of collapsing to `click:unknown`. */
  hitTargetKind:
    | 'pill' | 'pane-nav-tab' | 'pane-title' | 'pane-body'
    | 'status-bar' | 'vw-pane-title' | 'vw-pane-body'
    | 'input' | 'modal-body' | 'modal-button' | 'unknown'
    | null;
  /** Canonical `SurfaceAddress.kind` family projected from the current
   *  mouse hit when possible. Differs from `hitTargetKind`:
   *  - `hitTargetKind` is the exact UI hit variant (`vw-pane-title`,
   *    `modal-button`, `pill`, …)
   *  - `hitTargetSurfaceKind` is the broader address vocabulary used
   *    by R5 (`pane`, `modal`, `input`, …)
   *
   *  This stays null for non-addressable affordances (`pill`,
   *  `status-bar`) and for hits that are still only partially
   *  addressable (`pane-body` without a full pane address). */
  hitTargetSurfaceKind: SurfaceKind | null;
  /** Pane identifier for targets that have one (`pane-nav-tab` /
   *  `pane-title` / `pane-body` / `vw-pane-title` / `vw-pane-body`).
   *  Null when the HitTarget kind has no pane (pill / status-bar /
   *  unknown) or before the first mouse event. */
  hitTargetPaneId: string | null;
  /** Widget instance id for `pane-title` / `pane-body` targets that
   *  have one. Null when the pane has no widget, the HitTarget kind
   *  doesn't carry widget info, or before the first mouse event.
   *  Lets when-clauses scope to a specific widget:
   *  `"hitTargetWidgetInstanceId == 'wd-log'"`. */
  hitTargetWidgetInstanceId: string | null;
  /** Text-input widget id for `input` HitTarget events. Null for
   *  every other HitTarget kind (so a pane click immediately after an
   *  input click resets this key · no stale leak). Paired with
   *  `hitTargetKind == 'input'`, lets when-clauses declaratively
   *  scope to a specific composer: `"hitTargetKind == 'input' &&
   *  hitTargetInputId == 'chat-main'"`. Complementary to the matcher
   *  cascade (`click:input.chat-main` / `click:input`): matcher
   *  cascade is event-specific (fires once per click/drag/release);
   *  context key is state-reactive (when-clause can gate other
   *  bindings while pointer rests on the input). */
  hitTargetInputId: string | null;

  // ── U-0 · derived view mode ────────────────────────────────────
  /** Kind of the current dashboard view mode. Projected from
   *  `store.ui.viewMode.kind` by the U-0 bridge (bridges/view-mode.ts).
   *  Null only before the first `deriveViewMode()` publish —
   *  bridges/dashboard wiring guarantees a value early at boot.
   *  When-clauses: `viewModeKind == 'streaming'` / `viewModeKind
   *  != 'idle'` / etc. matches the seven `ViewModeKind` values
   *  defined in `src/input-core/view-mode.ts`. */
  viewModeKind:
    | 'idle' | 'input' | 'streaming' | 'chord-armed'
    | 'plugin' | 'modal' | 'terminal-modal'
    | null;

  // ── IDX-6 Phase 3 — theme state ────────────────────────────────
  /** Name of the currently active theme preset. Null only if the
   *  ThemeService hasn't been initialised yet; switches never
   *  produce null. When-clauses can gate on `themeName ==
   *  'rose-pine-dawn'` to adapt a binding to a specific theme. */
  themeName: string | null;
  /** True when the active theme's background is dark. Lets when-
   *  clauses swap glyphs (Unicode box vs ASCII dashes) depending
   *  on terminal rendering. */
  themeIsDark: boolean;
  /** True when the active theme is a pastel preset. Pastel themes
   *  deserve softer highlight/cursor glyphs than the high-contrast
   *  dark palettes. */
  themeIsPastel: boolean;
}

export const INITIAL_CONTEXT_KEYS: Readonly<ContextKeys> = Object.freeze({
  focusMode: 'pane' as const,
  activePaneId: null,
  modalTopTier: null,
  pickerOpen: false,
  popupOpen: false,
  dialogOpen: false,
  terminalModalActive: false,
  planModeActive: false,
  syncModeActive: false,
  controlModeActive: false,
  autoModeActive: false,
  budgetWarningActive: false,
  escalationPending: false,
  hoverTargetKind: null,
  hoverTooltip: null,
  contextMenuOpen: false,
  lastClickHitKind: null,
  hitTargetKind: null,
  hitTargetSurfaceKind: null,
  hitTargetPaneId: null,
  hitTargetWidgetInstanceId: null,
  hitTargetInputId: null,
  viewModeKind: null,
  themeName: null,
  themeIsDark: false,
  themeIsPastel: false,
});

export type ContextKeyName = keyof ContextKeys;

export interface ContextKeySubscriber {
  (keys: Readonly<ContextKeys>, changed: readonly ContextKeyName[]): void;
}

export interface ContextKeyService {
  /** Read-only snapshot. Returns the same object instance between
   *  updates so subscribers can reference-compare for cheap diffing. */
  readonly keys: Readonly<ContextKeys>;

  /** Merge a partial patch. Equality-checked per key; if nothing
   *  differs from the current snapshot, subscribers are NOT fired.
   *  Unknown keys in the patch are rejected (type-safe at compile
   *  time; at runtime they're silently skipped). */
  update(patch: Partial<ContextKeys>): void;

  /** Reset to INITIAL_CONTEXT_KEYS. Fires subscribers if any value
   *  currently differs from initial. */
  reset(): void;

  /** Subscribe. Returns a dispose function. Fires IMMEDIATELY with
   *  the current snapshot + empty change list so subscribers see
   *  initial state without racing update(). */
  subscribe(fn: ContextKeySubscriber): () => void;
}

/** Create a new service instance. Most consumers use the
 *  dashboard-level singleton; tests create their own. */
export function createContextKeyService(initial?: Partial<ContextKeys>): ContextKeyService {
  let state: Readonly<ContextKeys> = initial
    ? Object.freeze({ ...INITIAL_CONTEXT_KEYS, ...initial })
    : INITIAL_CONTEXT_KEYS;

  const subs = new Set<ContextKeySubscriber>();

  function fire(changed: readonly ContextKeyName[]): void {
    for (const s of subs) {
      try { s(state, changed); }
      catch {
        // A subscriber that throws must not break other subscribers
        // or the service itself. Errors are swallowed — dev can
        // instrument via debug.log if they care.
      }
    }
  }

  return {
    get keys() { return state; },

    update(patch) {
      const changed: ContextKeyName[] = [];
      const next = { ...state };
      for (const rawKey of Object.keys(patch) as ContextKeyName[]) {
        if (!(rawKey in INITIAL_CONTEXT_KEYS)) continue;   // ignore unknown keys
        const value = patch[rawKey];
        if (value === undefined) continue;                 // missing = leave as-is
        if ((next as Record<string, unknown>)[rawKey] !== value) {
          (next as Record<string, unknown>)[rawKey] = value;
          changed.push(rawKey);
        }
      }
      if (changed.length === 0) return;   // equality-based no-op
      state = Object.freeze(next);
      fire(changed);
    },

    reset() {
      const changed: ContextKeyName[] = [];
      for (const k of Object.keys(INITIAL_CONTEXT_KEYS) as ContextKeyName[]) {
        if ((state as Record<string, unknown>)[k] !== (INITIAL_CONTEXT_KEYS as Record<string, unknown>)[k]) {
          changed.push(k);
        }
      }
      if (changed.length === 0) return;
      state = INITIAL_CONTEXT_KEYS;
      fire(changed);
    },

    subscribe(fn) {
      subs.add(fn);
      // Prime subscriber with current snapshot + empty change list.
      // This lets subscribers initialise themselves from state without
      // racing the next update().
      try { fn(state, []); } catch { /* swallow — see fire() */ }
      return () => { subs.delete(fn); };
    },
  };
}
