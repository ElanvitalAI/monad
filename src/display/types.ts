import type { Action, KeyEvent, RenderCtx } from '../plugins/core/types.js';
import type { SurfaceInteractionClass } from './surface-interaction-policy.js';
import type { HostChromeProfile } from './host-chrome-profile.js';

export type { Action, KeyEvent, RenderCtx };

export type SurfaceKind =
  | 'pane'
  | 'widget'
  | 'modal'
  | 'overlay'
  | 'toast'
  | 'execution'
  | 'scratch';

export type SurfaceId = string;

export type SurfaceOwner =
  | 'dashboard'
  | `plugin:${string}`
  | `agent:${string}`
  | `tool:${string}`;

export interface DisplayMouseEvent {
  type: 'click' | 'double-click' | 'right-click' | 'scroll-up' | 'scroll-down' | 'drag' | 'release' | 'motion';
  row: number;
  col: number;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  /** IDX-F5 — structured hit classification attached by the wiring
   *  layer before routing. Consumers (modal.onMouse / pane click
   *  handlers / LLM SendMouseEvent) read `hitTarget` in preference to
   *  re-deriving from raw row/col. Absent on events that have not yet
   *  been classified, or clicks that fall outside every recognized
   *  region (dividers, HUD whitespace). See `src/display/hit-target.ts`
   *  for the synthesis helpers. */
  hitTarget?: HitTarget;
}

/** Host-owned modal chrome intent contract. Title rails and similar
 *  low-level chrome bands consume only this subset; ordinary widget
 *  body interactions should stay on widget-owned contracts instead of
 *  reusing these raw host semantics. */
export type ModalChromeMouseEventType = Extract<
  DisplayMouseEvent['type'],
  'click' | 'double-click' | 'drag' | 'release'
>;

export function isModalChromeMouseEventType(
  type: DisplayMouseEvent['type'],
): type is ModalChromeMouseEventType {
  return type === 'click' || type === 'double-click' || type === 'drag' || type === 'release';
}

/** Host capture/session continuation contract. Used by drag / resize /
 *  move adapters that own pointer capture until the gesture settles. */
export type CaptureSessionMouseEventType = Extract<
  DisplayMouseEvent['type'],
  'drag' | 'release'
>;

export function isCaptureSessionMouseEventType(
  type: DisplayMouseEvent['type'],
): type is CaptureSessionMouseEventType {
  return type === 'drag' || type === 'release';
}

export function isCaptureSessionEndMouseEventType(
  type: DisplayMouseEvent['type'],
): type is Extract<CaptureSessionMouseEventType, 'release'> {
  return type === 'release';
}

/** Modal-dismiss host contract. Surfaces that own outside-click
 *  dismissal may accept this wider set, including the initial release
 *  that follows an opening click outside the surface. */
export type DismissMouseEventType = Extract<
  DisplayMouseEvent['type'],
  'click' | 'double-click' | 'right-click' | 'release'
>;

export function isDismissMouseEventType(
  type: DisplayMouseEvent['type'],
): type is DismissMouseEventType {
  return type === 'click' || type === 'double-click' || type === 'right-click' || type === 'release';
}

/** Mount-time dismiss grace. Some transient surfaces ignore the first
 *  outside release that follows the opening click so the opener does
 *  not immediately dismiss what it just created. */
export type DismissGraceMouseEventType = Extract<
  DisplayMouseEvent['type'],
  'release'
>;

export function isDismissGraceMouseEventType(
  type: DisplayMouseEvent['type'],
): type is DismissGraceMouseEventType {
  return type === 'release';
}

/** Pre-capture source reset contract. Drag-source threshold arms use
 *  this to drop pending press state before a session has started. */
export type PreCaptureResetMouseEventType = Extract<
  DisplayMouseEvent['type'],
  'click' | 'release'
>;

export function isPreCaptureResetMouseEventType(
  type: DisplayMouseEvent['type'],
): type is PreCaptureResetMouseEventType {
  return type === 'click' || type === 'release';
}

/** Host pointer-focus retarget contract. Live workspace/modal hosts
 *  use this when mouse movement or direct pointer actions should
 *  change the focused child region before delegating the event. */
export type PointerFocusMouseEventType = Extract<
  DisplayMouseEvent['type'],
  'click' | 'double-click' | 'drag' | 'motion'
>;

export function isPointerFocusMouseEventType(
  type: DisplayMouseEvent['type'],
): type is PointerFocusMouseEventType {
  return type === 'click' || type === 'double-click' || type === 'drag' || type === 'motion';
}

/** Discrete click-like host input. Used by popup dismissal, click-hit
 *  publication, and diagnostics that care about deliberate click
 *  actions but not drag/wheel/motion streams. */
export type DiscreteClickMouseEventType = Extract<
  DisplayMouseEvent['type'],
  'click' | 'double-click' | 'right-click'
>;

export function isDiscreteClickMouseEventType(
  type: DisplayMouseEvent['type'],
): type is DiscreteClickMouseEventType {
  return type === 'click' || type === 'double-click' || type === 'right-click';
}

/** Primary-button discrete click contract. Host buttons / focus shifts /
 * row-activation seams use this when `right-click` must stay out of
 * the primary action lane but `click` and `double-click` share the
 * same routing contract. */
export type PrimaryDiscreteClickMouseEventType = Extract<
  DisplayMouseEvent['type'],
  'click' | 'double-click'
>;

export function isPrimaryDiscreteClickMouseEventType(
  type: DisplayMouseEvent['type'],
): type is PrimaryDiscreteClickMouseEventType {
  return type === 'click' || type === 'double-click';
}

/** Secondary-button discrete click contract. Host context-menu and
 * alternate-action seams use this to keep right-click routing out of
 * the primary activation lane. */
export type SecondaryClickMouseEventType = Extract<
  DisplayMouseEvent['type'],
  'right-click'
>;

export function isSecondaryClickMouseEventType(
  type: DisplayMouseEvent['type'],
): type is SecondaryClickMouseEventType {
  return type === 'right-click';
}

/** Primary-button single-click contract. Use this when a host trigger
 * should react only to the base left-click press, not double-click or
 * secondary-button actions. */
export type PrimaryButtonClickMouseEventType = Extract<
  DisplayMouseEvent['type'],
  'click'
>;

export function isPrimaryButtonClickMouseEventType(
  type: DisplayMouseEvent['type'],
): type is PrimaryButtonClickMouseEventType {
  return type === 'click';
}

/** PTY/terminal forwarding contract. Terminal transports accept only
 * native press / wheel / drag / release signals; widget-synthesized
 * `double-click` and hover-only `motion` stay outside the PTY lane. */
export type PtyForwardMouseEventType = Exclude<
  DisplayMouseEvent['type'],
  'double-click' | 'motion'
>;

export function isPtyForwardMouseEventType(
  type: DisplayMouseEvent['type'],
): type is PtyForwardMouseEventType {
  return type !== 'double-click' && type !== 'motion';
}

/** IDX-F5 — discriminated union describing *what* a mouse event hit.
 *  Synthesized by `dashboard-mouse-wiring` and the eventual
 *  `View.describeHit` per-widget API. Consumer contracts:
 *    • `pill`             — status-bar pill; `name` mirrors
 *                           `status-bar-pills.ts::PillName`
 *    • `pane-nav-tab`     — top pane-nav tab strip
 *    • `pane-title`       — pane title row
 *    • `pane-body`        — pane body cells (excluding title + nav)
 *    • `modal-body`       — interior of a mounted modal surface
 *                           (SelectView row etc.). `itemIndex` is
 *                           populated by `View.describeHit` when the
 *                           widget supports row-level addressing.
 *    • `modal-title`      — title-rail hit on a framed modal. This
 *                           excludes close/minimize chrome buttons
 *                           and is reserved for popup/window move.
 *    • `modal-button`     — Dialog button / approval button. `buttonId`
 *                           identifies the specific button (eg `ok`
 *                           / `cancel` / confirmation kind).
 *    • `vw-pane-title`    — virtual-window pane title
 *    • `vw-pane-body`     — virtual-window pane body
 *    • `status-bar`       — bare status row click outside every pill
 *                           (fallback; consumers may use it to return
 *                           focus to input or similar).
 *
 *  F5 lands the type itself + status-bar classification first;
 *  pane / modal / vw kinds are synthesized by downstream phases. Keep
 *  this union authoritative — any new hit kind should be added here
 *  before being produced so `exhaustiveHit` guards stay tight. */
export type HitTarget =
  | { kind: 'pill'; name: HitPillName }
  | { kind: 'pane-nav-tab'; paneId: string }
  | { kind: 'pane-title'; paneId: string; widgetInstanceId?: string }
  | {
      kind: 'pane-body';
      paneId: string;
      widgetInstanceId?: string;
      /** IDX-F5d — pane-local row (0-indexed), title row included when
       *  the layout drew one. Widgets call `describeHit` internally to
       *  translate this into `hit`. Populated by `getPaneHitTarget`
       *  (dashboard.ts) from `hitTestLayoutCell`'s `localRow`.
       *  Present on every pane-body hit where layout hit-test succeeds
       *  — absence means the wiring layer built the HitTarget
       *  without a live layout (tests, recovery paths). */
      bodyRow?: number;
      /** IDX-F5d — pane-local col, analogous to bodyRow. */
      bodyCol?: number;
      /** IDX-F5d — widget refinement returned by `Widget.describeHit`.
       *  Mirrors `modal-body.itemIndex` but opens the surface to non-
       *  list widgets (table cells, text chars) via a discriminated
       *  `WidgetHitDescriptor` union. Consumers that only care about
       *  list rows read `hit?.kind === 'list-row' ? hit.itemIndex : null`
       *  — the kind check keeps future descriptor kinds from confusing
       *  existing readers. */
      hit?: WidgetHitDescriptor;
    }
  | { kind: 'modal-body'; modalId: SurfaceId; itemIndex?: number }
  | { kind: 'modal-title'; modalId: SurfaceId }
  | { kind: 'modal-button'; modalId: SurfaceId; buttonId: string }
  | { kind: 'vw-pane-title'; windowId: string; paneId: string }
  | { kind: 'vw-pane-body'; windowId: string; paneId: string }
  // DS-3a preflight (PLAN-hittarget-input-kind-extension.md) — chat
  // input / any dashboard-hosted textInput widget. `inputId` matches
  // `SurfaceRegistry` address `{kind:'input', inputId}` (dashboard.ts:
  // 12010 defines the canonical `'chat-main'`). Distinct from pane
  // kinds because textInputs are not panes — they're direct-render
  // widgets with their own focus + cursor lifecycle.
  | { kind: 'input'; inputId: string }
  | { kind: 'status-bar' };

/** IDX-F5d — widget-owned refinement of a `pane-body` HitTarget.
 *  Mirrors `ViewHitDescriptor` (src/ui/view.ts:52) for the pane rail.
 *  Discriminated on `kind` so future widget families (table, text,
 *  heatmap) can add their own kind without breaking consumers that
 *  only read `'list-row'` today.
 *
 *  Populated by `Widget.describeHit(state, ctx, localRow, localCol)`
 *  when the widget overrides it; `getPaneHitTarget` composes the full
 *  HitTarget via `applyPaneIdToRefinement` (src/display/hit-target.ts).
 *  Null describeHit result → `hit` field omitted entirely. */
export type WidgetHitDescriptor =
  | { kind: 'list-row'; itemIndex: number }
  /** Reserved for future adoption by `table` / `scheduler-board`. */
  | { kind: 'table-cell'; row: number; col: number }
  /** Reserved for future adoption by `markdown` / `scratch`. */
  | { kind: 'text-char'; line: number; col: number }
  /** P1 conversation widget primitive — block-level transcript hit.
   *  `rangeStart/rangeEnd` are body-line indexes inside the widget's
   *  transcript model, not screen rows. */
  | {
    kind: 'conversation-message';
    sessionId: string;
    messageId: string;
    role: string;
    channel?: string;
    rangeStart: number;
    rangeEnd: number;
  };

/** IDX-F5 — pill name literal duplicated from `status-bar-pills.ts` so
 *  `display/types.ts` stays dependency-free (this file is imported by
 *  the coordinator; pulling in status-bar-pills would invert the layer
 *  order). A compile-time compat assertion in
 *  `src/display/hit-target.ts` catches divergence if the pill
 *  inventory is changed in one place and not the other. */
export type HitPillName =
  | 'workingDir'
  | 'model'
  | 'virtualWindow'
  | 'shellRollup'
  | 'mode'
  | 'workspaceDock'
  | 'conversationPopup'
  | 'acpSending';

/** IDX-F1 — Modal tier. A role-based label that groups surfaces on
 *  the coordinator stack so `topOfTier(tier)` can find the highest
 *  surface of a given role without consulting singleton caches like
 *  `mouseWiring.activePopup` or `terminalModalRouter.current()`.
 *
 *  Tiers are ordered by user-facing precedence — a higher-tier modal
 *  visually and interactively sits above a lower-tier one when both
 *  are mounted. IDX-F4 promotes this to a const-object enum with
 *  `TIER_ORDER` and `tiersCompatible` helpers. The const-object
 *  pattern keeps runtime output to a plain string (no TS `enum`
 *  compile artifacts) while giving us iteration + exhaustive
 *  exhaustiveness-check support. */
export const MODAL_TIER = {
  vw: 'vw',               // virtual-window host surfaces (base layer)
  execution: 'execution', // recipe:* execution overlays
  terminal: 'terminal',   // PTY-backed interactive terminal modal
  dialog: 'dialog',       // ask-user / approval / plan-exit / confirmation
  popup: 'popup',         // pill popup (model / wd / mode / swd / shellRollup)
  menu: 'menu',           // context menu / dropdown / submenu (F7)
  picker: 'picker',       // chat slash/arg/@ picker (focus:'participates')
  tooltip: 'tooltip',     // hover tooltip (non-interactive overlay, top)
} as const;

export type ModalTier = (typeof MODAL_TIER)[keyof typeof MODAL_TIER];

/** IDX-F4 — canonical layering order, low rank → high rank. A higher-
 *  rank tier may appear above a lower-rank tier in the modal stack;
 *  same-rank tiers may stack (e.g. two dialogs, nested menus). See
 *  `tiersCompatible` for the enforcement helper used by the
 *  MONAD_BOUNDARY_CHECK dev-assertion path. */
export const TIER_ORDER: readonly ModalTier[] = [
  'vw', 'execution', 'terminal', 'dialog', 'popup', 'menu', 'picker', 'tooltip',
] as const;

/** IDX-F4 — rank lookup. Returns `-1` for an unknown tier. */
export function tierRank(tier: ModalTier): number {
  return TIER_ORDER.indexOf(tier);
}

/** IDX-F4 — true when mounting a `next`-tier modal on top of a
 *  `top`-tier modal is legal. Legal means `next` is equal or higher
 *  in TIER_ORDER. A modal pushed below its current top violates the
 *  layering contract (e.g. a `vw` host opened while a `dialog` is
 *  already active). `top=undefined` (empty stack) is always OK. */
export function tiersCompatible(
  top: ModalTier | undefined,
  next: ModalTier,
): boolean {
  if (top === undefined) return true;
  const topRank = tierRank(top);
  const nextRank = tierRank(next);
  if (topRank < 0 || nextRank < 0) return true; // unknown tier → skip check
  return nextRank >= topRank;
}

/** Q3 (substrate Occam refactor, 2026-05-03) — three-state focus
 *  declaration on a DisplaySurface. Replaces the legacy two-bool pair
 *  `focusable: boolean` + `keyParticipating?: boolean`, whose 4th
 *  combination (focusable:true + keyParticipating:false) was
 *  meaningless. The enum makes that combination type-impossible.
 *
 *    • 'owns'         — focus-eligible AND receives onKey routing.
 *                       Default for modals, panes, dialogs.
 *    • 'participates' — receives onKey routing but never owns
 *                       focus.active. Slot for chat slash/at/skill
 *                       pickers that paint above the chat input
 *                       while the input cursor stays live.
 *    • 'none'         — passive paint, no focus, no key delivery
 *                       (tooltip / hover overlay).
 *
 *  See REQUIREMENTS-substrate-occam-2026-05-03.md §1.13 + Q3 decision. */
export type SurfaceFocus = 'owns' | 'participates' | 'none';

/** True when the surface's `focus` declaration makes it eligible to
 *  become the focus.active owner. Mirrors the legacy `focusable === true`
 *  meaning at the surface layer. (FocusNode.focusable, in the
 *  focus-manager primitive, stays a separate bool — the coordinator
 *  derives it from surface.focus when registering the node.) */
export function surfaceCanOwnFocus(focus: SurfaceFocus): boolean {
  return focus === 'owns';
}

/** True when the surface receives onKey routing — `'owns'` (focused
 *  surfaces) and `'participates'` (paint-only key consumers like chat
 *  pickers). Replaces the legacy `focusable || keyParticipating === true`
 *  predicate. */
export function surfaceParticipatesInKeys(focus: SurfaceFocus): boolean {
  return focus !== 'none';
}

export interface DisplaySurface {
  id: SurfaceId;
  kind: SurfaceKind;
  owner: SurfaceOwner;
  /** Optional workspace affinity for transient surfaces that should
   *  travel with / be disposed alongside a specific foreground
   *  workspace rather than defaulting to dashboard-main residency. */
  ownerWorkspaceId?: SurfaceId;
  /** Q3 (substrate Occam) — three-state focus declaration. See
   *  `SurfaceFocus` for semantics. Replaces the legacy `focusable` +
   *  `keyParticipating` pair. */
  focus: SurfaceFocus;
  priority: number;
  /** IDX-F1 — optional role tier. See `ModalTier`. Absent = legacy
   *  surface with no tier declared. F4 makes this required for all
   *  modal-kind surfaces. */
  tier?: ModalTier;
  /** Canonical interaction class. Product-level meaning defined in
   *  `surface-interaction-policy.ts`:
   *   - `workspace`: Main-equivalent foreground work surface (e.g. VW)
   *   - `blocking-modal`: true popup / dialog / picker / terminal modal
   *   - `embedded-overlay`: companion / local overlay that coexists
   *
   *  Declared optional on the base surface so generic surface consumers
   *  (coordinator focus-dirty diagnostics, dashboard modal-state logs)
   *  may read it without narrowing to `ModalSurface`. Absent = policy
   *  helpers infer the class from `windowRole` /
   *  `backgroundInteractionPolicy` / `hostChromeProfile`. `ModalSurface`
   *  re-declares the same optional field with matching semantics. */
  interactionClass?: SurfaceInteractionClass;
  /** Policy-input fields (모두 optional on base) — surface-interaction-policy
   *  헬퍼가 interactionClass 부재 시 이들로 클래스를 유추한다. ModalSurface 는
   *  동형 optional 로 재선언. base 에 둬 정책 헬퍼가 DisplaySurface 를 그대로
   *  받도록(coordinator 등 non-modal 소비자가 narrow 없이 호출). */
  hostChromeProfile?: HostChromeProfile;
  windowRole?: 'foreground' | 'companion';
  backgroundInteractionPolicy?: 'allow' | 'block';
  ttlMs?: number;
  render(ctx: RenderCtx): string[];
  /** KX1 — return types:
   *   - `Action` (non-'none'): surface emits a plugin-level command; coordinator
   *     stops routing and dashboard dispatches the action.
   *   - `'consumed'`: surface ate the key silently; coordinator stops routing,
   *     dashboard just redraws (no action dispatch).
   *   - `'passthrough'` or `{ type: 'none' }` or no handler: coordinator tries
   *     the next priority level (execution → active → keybinding).
   *
   *   IDX-F1.5 — may also return a Promise of the above. The sync
   *   `routeKey` path treats a Promise as `null` (falls through to
   *   the next priority); async-aware callers use the `Async` variants
   *   (`routeKeyAsync`, `tryRouteKeyToTopModalAsync`). Chat picker
   *   onKey (F2.5) uses the async path so `picker.dispatch` can hit
   *   the filesystem for at-picker scans without blocking the sync
   *   routing legacy contract. */
  onKey?(ev: KeyEvent):
    | Action | 'consumed' | 'passthrough'
    | Promise<Action | 'consumed' | 'passthrough'>;
  onMouse?(ev: DisplayMouseEvent): Action;
  dispose?(): void;
}

export type FocusScope = 'global' | 'dashboard' | 'plugin' | 'modal' | 'execution';

export interface FocusNode {
  id: SurfaceId;
  owner: SurfaceOwner;
  focusable: boolean;
  parent?: SurfaceId;
  scope: FocusScope;
  order: number;
}

export interface FocusState {
  active: SurfaceId | null;
  previous?: SurfaceId;
  stack: SurfaceId[];
}

export type DisplayKeyScope = 'global' | SurfaceId | SurfaceOwner;

export interface DisplayKeyBinding {
  id: string;
  /** Key spec. Single key (`'C-k'`) or chord body paired with
   *  `chordPrefix` (`'C-m' + 'p'` ⇒ Ctrl+M then p). Q4 (substrate
   *  Occam, 2026-05-03): bindings declare a single canonical (latin)
   *  form; Korean IME jamo aliases are resolved by the central
   *  KEY_ALIAS_TABLE (input-core/key-alias-table.ts) at lookup time.
   *  The legacy pipe syntax (`'C-k|C-ㅏ'`) is gone. */
  key: string;
  scope: DisplayKeyScope;
  /** Either `command` (slash-command string dispatched via the
   *  plugin host) OR `handler` (local callback) must be provided.
   *  `handler` wins when both are present. */
  command?: string;
  handler?: () => void;
  priority?: number;
  when?(snapshot: DisplaySnapshot): boolean;
  /** FU-1 — when set, this binding arms after the prefix key is
   *  pressed and fires when the following key matches `key`. Arming
   *  times out after `chordTimeoutMs` (default 1000ms). */
  chordPrefix?: string;
  chordTimeoutMs?: number;
}

export type DisplayKeyRouteResult =
  | { type: 'passthrough' }
  | { type: 'consumed'; surfaceId: SurfaceId }
  | { type: 'action'; surfaceId: SurfaceId; action: Action }
  | { type: 'command'; binding: DisplayKeyBinding; command: string }
  | { type: 'handler'; binding: DisplayKeyBinding; invoke: () => void }
  /** FU-1 — prefix of a chord binding was pressed; coordinator is
   *  now armed waiting for the body key. Caller should consume the
   *  key (swallow) so it doesn't leak into the buffer. */
  | { type: 'chord-armed'; prefix: string };

export interface DisplayDisposable {
  dispose(): void;
}

export interface ScratchSurfaceState {
  source: string;
  mode: string;
  title: string;
  lines: string[];
  pinned?: boolean;
  ttlMs?: number;
  updatedAt: number;
}

export type DisplayCommand =
  | { type: 'upsertSurface'; surface: DisplaySurface }
  | { type: 'patchWidget'; id: string; patch: Record<string, unknown> }
  | { type: 'appendLog'; line: string }
  | {
      type: 'setScratch';
      source: string;
      mode: string;
      title: string;
      lines: string[];
      pinned?: boolean;
      ttlMs?: number;
    }
  | { type: 'setFocus'; target: SurfaceId; reason?: string }
  | { type: 'closeSurface'; id: SurfaceId }
  | { type: 'requestRender'; region?: SurfaceId | 'all'; force?: boolean };

export interface DisplayHandle {
  owner: SurfaceOwner;
  publish(command: DisplayCommand): void;
  requestRender(opts?: { region?: SurfaceId | 'all'; force?: boolean }): void;
  focus(target: SurfaceId): void;
  currentFocus(): SurfaceId | null;
  cycleFocus(scope?: FocusScope | SurfaceOwner, dir?: 1 | -1): SurfaceId | null;
  registerFocus(node: Omit<FocusNode, 'owner'> & { owner?: SurfaceOwner }): DisplayDisposable;
  registerKey(binding: Omit<DisplayKeyBinding, 'id'> & { id?: string }): DisplayDisposable;
}

export interface DisplayRenderRequest {
  dirty: Set<SurfaceId | 'all' | 'status' | 'dock'>;
  force: boolean;
}

export interface DisplaySnapshot {
  surfaces: Map<SurfaceId, DisplaySurface>;
  focusNodes: Map<SurfaceId, FocusNode>;
  focus: FocusState;
  scratch: ScratchSurfaceState | null;
  keyBindings: DisplayKeyBinding[];
  pendingWidgetPatches: Array<{ id: string; patch: Record<string, unknown> }>;
  pendingLogLines: string[];
  /** P2.2.b — current cursor request. Read by tests + future modal
   *  paint pipeline. The coordinator emits the corresponding ANSI
   *  via the writeCursor option after onRender. Null = hidden. */
  cursor: import('./cursor-state.js').CursorState | null;
}

export interface DisplayHooks {
  beforeRender?(request: DisplayRenderRequest, snapshot: DisplaySnapshot): void;
  afterRender?(request: DisplayRenderRequest, snapshot: DisplaySnapshot): void;
  onSurfaceMounted?(surface: DisplaySurface): void;
  onSurfaceDisposed?(surface: DisplaySurface): void;
  onFocusChanged?(prev: SurfaceId | null, next: SurfaceId, reason?: string): void;
}
