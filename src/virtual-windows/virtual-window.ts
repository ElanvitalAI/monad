// VirtualWindow — VW-P4.
//
// A VirtualWindow owns a layout tree of panes (LayoutNode) plus a
// map of paneId → PaneContent. It renders as a single ModalSurface
// that covers the coordinator's grid (exactly one is foreground at
// a time; others are detached — see WindowRegistry, VW-P5).
//
// Key routing:
//   • The dashboard-level prefix chord (Ctrl+B + sequence) is
//     intercepted BEFORE this class sees a key. When a key reaches
//     VirtualWindow.onKey, it's destined for the focused pane.
//   • Pane-content delegates return the standard Action shape so
//     tests + plugin hooks stay uniform.

import { ansi, C, visibleWidth, stripAnsi } from '../tui.js';
import { debug } from '../debug/log.js';
import { DEFAULT_HOST_CHROME_PROFILE } from '../display/host-chrome-profile.js';
import {
  allPaneIds,
  closePane,
  dividerAt,
  focusNeighbor,
  layoutRects,
  leaf,
  paneAt,
  resizePane,
  splitPane,
  SplitRejectedError,
  type Axis,
  type Direction,
  type DividerHit,
  type LayoutNode,
  type Rect,
  type SplitLimits,
} from './layout-tree.js';
import type { PaneRect } from './layout-tree.js';
import type { PaneBroadcast, PaneContent } from './pane-content.js';
import type { ModalBounds, ModalSurface } from '../display/modal-stack.js';
import {
  isCaptureSessionEndMouseEventType,
  isCaptureSessionMouseEventType,
  isPrimaryDiscreteClickMouseEventType,
  isSecondaryClickMouseEventType,
  type Action,
  type DisplayMouseEvent,
  type KeyEvent,
  type SurfaceId,
} from '../display/types.js';
import type { CursorState } from '../display/cursor-state.js';
import type { WindowId, PaneId } from './addressing.js';
import { composeVisibilityBadge, badgeVisibleWidth } from '../panes/visibility-badge.js';
import type { PaneVisibility } from '../panes/visual-state.js';
import { secondaryActionTargetAt } from './secondary-action.js';
import { paneBorderTitle } from '../panes/pane-title.js';
import { pulsePhase } from '../agent-activity-hud.js';
import {
  inlineEditorClear,
  type InlineEditorState,
} from '../input-core/inline-editor.js';
import { applyInlineEditorKey } from '../input-core/inline-editor-key.js';

export interface VirtualWindowSpec {
  id: WindowId;
  title: string;
  rootContent: PaneContent;
  /** Override bounds — defaults to fullscreen over the dashboard. */
  bounds?: ModalBounds;
  /** Per-window split limits — defaults to layout-tree DEFAULT_LIMITS. */
  limits?: SplitLimits;
  /** Bundle B-7-γ — resolver for the focused pane's PaneVisualState
   *  `visibility` axis. When set, paintPane appends a short badge
   *  (`·H·` / `·D·` / `·ᴸ·`) to the focused pane's label for any
   *  non-default state. Omit to keep labels unchanged (default). */
  visibilityResolver?: (paneId: PaneId) => PaneVisibility;
  /** Deterministic clock for chrome motion. Omit in prod. */
  now?: () => number;
}

export interface VirtualWindowRenderCtx {
  termCols: number;
  termRows: number;
}

export type LocalInputTarget =
  | { kind: 'focused' }
  | { kind: 'all' }
  | { kind: 'pane'; paneId: PaneId };

export interface LocalInputSubmitRequest {
  broadcast: PaneBroadcast;
  target: LocalInputTarget;
}

export interface LocalInputTargetPickerRequest {
  windowId: WindowId;
  seedQuery?: string;
}

export interface VirtualWindowEvents {
  onPaneCreate?: (paneId: PaneId) => void;
  onPaneClose?: (paneId: PaneId) => void;
  onPaneFocus?: (paneId: PaneId) => void;
  onClose?: () => void;
  /** Fires when the user submits this window's local composer.
   *  The host decides how to route it: focused pane, target picker,
   *  or a legacy broadcast path. VW owns only the local input state. */
  onLocalInputSubmit?: (windowId: WindowId, req: LocalInputSubmitRequest) => void;
  /** Backward-compat path for the original per-VW sync bar contract.
   *  New consumers should prefer `onLocalInputSubmit`. */
  onSyncInputSubmit?: (windowId: WindowId, text: string) => void;
  /** VW-U4 — fires when the user right-clicks a pane body region
   *  (or the border). Host typically opens a pane/window selector
   *  popup anchored at (col, row). `paneId` is null on border hits. */
  onShowSelector?: (windowId: WindowId, paneId: PaneId | null, col: number, row: number) => void;
  /** R6 — pane title right-click is distinct from pane body:
   *  title goes through the menu-provider path while body keeps the
   *  selector popup path. */
  onShowContextMenu?: (windowId: WindowId, paneId: PaneId, col: number, row: number) => void;
  /** Request a target-picker popup for the local composer. Host owns
   *  the popup lifecycle; VW only exposes candidate targets/state. */
  onOpenLocalInputTargetPicker?: (req: LocalInputTargetPickerRequest) => void;
}

/** State for the per-window local composer. When active, the window
 *  reserves rows at the bottom for a prompt-style input surface.
 *  Keys captured there accumulate in `composed` until Enter emits a
 *  host-routed submit event. */
export interface WindowLocalComposerState {
  active: boolean;
  composed: string;
  /** Horizontal scroll offset so the cursor stays visible when the
   *  composed buffer overflows the bar width. Recomputed each
   *  render; stored so consecutive frames stay consistent. */
  scrollCol: number;
  /** U1 — caret position within `composed` (0..composed.length).
   *  Inserts happen at this index, Backspace deletes the char
   *  immediately before it, Delete deletes the char at the index.
   *  Arrow keys / Home / End mutate this. */
  cursorPos: number;
}

/** Backward-compat alias while callers migrate off the old name. */
export type SyncInputBarState = WindowLocalComposerState;

/** U2 — upper bound on rows the per-window local composer can claim.
 *  Panes keep at least (window_height - 2 - this_value - 1) rows so
 *  they stay visible while the user composes a long broadcast. */
export const WINDOW_LOCAL_COMPOSER_MAX_ROWS = 6;
/** Backward-compat alias. */
export const SYNC_BAR_MAX_ROWS = WINDOW_LOCAL_COMPOSER_MAX_ROWS;

export class VirtualWindow {
  readonly id: WindowId;
  title: string;
  private tree: LayoutNode;
  private panes = new Map<PaneId, PaneContent>();
  private focusedPaneId: PaneId;
  private bounds: ModalBounds;
  private state: 'foreground' | 'background' | 'closed' = 'background';
  private limits?: SplitLimits;
  /** VW-U1 — when foreground, the top border + corners paint in accent
   *  tone instead of muted so the user can spot the active window at
   *  a glance. WindowRegistry.switchTo() flips this on the new
   *  foreground and off on the previous one. */
  private borderAccent = false;
  /** VW-U5 — when non-null, only this pane renders, filling the full
   *  inner rect. Other panes skip their paint pass. The layout tree
   *  itself is unchanged — exiting zoom restores the previous view
   *  exactly. Cleared automatically when the zoomed pane is closed. */
  private zoomedPaneId: PaneId | null = null;
  /** VW-U5 — swap target for `^B Tab`. Holds the pane that was focused
   *  BEFORE the current focus. Updated in setFocus(); flipping between
   *  two panes produces A → B → A → B… */
  private previousFocusedPaneId: PaneId | null = null;
  /** VW-B2 — per-pane display title overrides. When set, paintPane
   *  renders `[abc123] custom-name` instead of the canonical
   *  `content.title`. Map entries are cleaned up in closePaneAt. */
  private paneTitleOverrides = new Map<PaneId, string>();
  /** VW-A3 — active divider drag state. Set on click→drag start when
   *  the initial click lands on a split boundary; cleared on release
   *  or when the pointer leaves the modal. */
  private dragDivider: {
    hit: DividerHit;
    lastPointer: number;
  } | null = null;
  private readonly events: VirtualWindowEvents;
  /** Window-local composer state. Not persisted across sessions. */
  private syncBar: WindowLocalComposerState = { active: false, composed: '', scrollCol: 0, cursorPos: 0 };
  /** Target for the local composer. Null means "follow focused pane". */
  private localInputTarget: LocalInputTarget = { kind: 'focused' };
  /** Bundle B-7-γ — paneId → PaneVisibility resolver, populated from
   *  VirtualWindowSpec. Null when the host didn't wire a store; in
   *  that case paintPane treats every pane as 'visible' (no badge). */
  private readonly visibilityResolver: ((paneId: PaneId) => PaneVisibility) | null;
  private readonly now: () => number;

  constructor(spec: VirtualWindowSpec, events: VirtualWindowEvents = {}) {
    this.id = spec.id;
    this.title = spec.title;
    this.panes.set(spec.rootContent.id, spec.rootContent);
    this.tree = leaf(spec.rootContent.id);
    this.focusedPaneId = spec.rootContent.id;
    this.bounds = spec.bounds ?? { row: 1, col: 1, width: 80, height: 24 };
    this.limits = spec.limits;
    this.events = events;
    this.visibilityResolver = spec.visibilityResolver ?? null;
    this.now = spec.now ?? Date.now;
    spec.rootContent.start();
    this.events.onPaneCreate?.(spec.rootContent.id);
  }

  get focused(): PaneId { return this.focusedPaneId; }
  get isClosed(): boolean { return this.state === 'closed'; }

  setBounds(bounds: ModalBounds): void {
    this.bounds = bounds;
  }

  getBounds(): ModalBounds {
    return { ...this.bounds };
  }

  /** VW-U1 — called by WindowRegistry.switchTo. Idempotent. */
  setBorderAccent(active: boolean): void {
    this.borderAccent = active;
  }

  /** VW-B1 — rename the window. Registry fires a 'window:rename' event
   *  via its wrapper so subscribers (pickers, element-registry) can
   *  pick up the new title without re-polling. */
  setTitle(next: string): void {
    this.title = next;
  }

  /** VW-B2 — per-pane display title override. Stored on the VW so
   *  PaneContent.title stays canonical; getPaneDisplayTitle prefers
   *  the override when present. Passing empty string clears the
   *  override (reverts to PaneContent.title). */
  setPaneTitle(paneId: PaneId, next: string): boolean {
    if (!this.panes.has(paneId)) return false;
    const trimmed = next.trim();
    if (!trimmed) { this.paneTitleOverrides.delete(paneId); return true; }
    this.paneTitleOverrides.set(paneId, trimmed);
    return true;
  }

  /** VW-B2 — canonical display title. Override wins when present. */
  getPaneDisplayTitle(paneId: PaneId): string {
    const override = this.paneTitleOverrides.get(paneId);
    if (override) return override;
    return this.panes.get(paneId)?.title ?? '';
  }

  getHostChromeProfile() {
    return this.getFocusedPane()?.hostChromeProfile ?? DEFAULT_HOST_CHROME_PROFILE;
  }

  /** VW-B2 — clear on pane close; kept as an internal helper. */
  private clearPaneTitleOverride(paneId: PaneId): void {
    this.paneTitleOverrides.delete(paneId);
  }


  isBorderAccent(): boolean {
    return this.borderAccent;
  }

  listPanes(): Array<{ id: PaneId; content: PaneContent }> {
    return [...this.panes.entries()].map(([id, content]) => ({ id, content }));
  }

  /** Phase 3a · save path — read-only accessor to the current layout
   *  binary tree. Consumed by `snapshotWindow()` in layout/tree.ts to
   *  produce a serializable LayoutSpec. Returned reference is the live
   *  tree (caller must not mutate); see `layout/restore-planner.ts`
   *  for the adapter that round-trips through LayoutSpec. */
  getLayoutTree(): LayoutNode {
    return this.tree;
  }

  getPane(id: PaneId): PaneContent | null {
    return this.panes.get(id) ?? null;
  }

  /** SP-D — expose the focused pane content to chord handlers that
   *  need to probe/mutate focus-policy without poking panes Map. */
  getFocusedPane(): PaneContent | null {
    return this.panes.get(this.focusedPaneId) ?? null;
  }

  /** SP-A / A.3 — true iff the focused pane's declared focus policy
   *  is not `output-only`. Used by window cycling to skip windows
   *  whose focused pane is intentionally read-mostly. */
  hasInteractableFocus(): boolean {
    const pane = this.panes.get(this.focusedPaneId);
    if (!pane) return true;
    return pane.focusPolicy !== 'output-only';
  }

  getLayout(): LayoutNode {
    return this.tree;
  }

  paneRects(): PaneRect[] {
    return layoutRects(this.tree, this.innerRect());
  }

  // ─── Mutations ──────────────────────────────────────────────────

  /** Resize the split enclosing `paneId` along `axis` by `delta` cells.
   *  Delegates to layout-tree's resizePane which enforces SplitLimits.
   *  Returns true when the tree changed, false when delta rounded to
   *  a no-op or no matching-axis split was found. */
  resizePaneAt(paneId: PaneId, axis: Axis, delta: number): boolean {
    if (!this.panes.has(paneId) || delta === 0) return false;
    const next = resizePane(this.tree, paneId, axis, delta, this.innerRect());
    if (next === this.tree) return false;
    this.tree = next;
    return true;
  }

  splitFocused(axis: Axis, newContent: PaneContent, ratio = 0.5): PaneId {
    return this.splitPaneAt(this.focusedPaneId, axis, newContent, ratio);
  }

  splitPaneAt(paneId: PaneId, axis: Axis, newContent: PaneContent, ratio = 0.5): PaneId {
    const next = splitPane({
      tree: this.tree,
      paneId,
      axis,
      newPaneId: newContent.id,
      ratio,
      bounds: this.innerRect(),
      limits: this.limits,
    });
    this.tree = next;
    this.panes.set(newContent.id, newContent);
    newContent.start();
    this.events.onPaneCreate?.(newContent.id);
    // Focus the new pane (tmux default).
    this.setFocus(newContent.id);
    return newContent.id;
  }

  closeFocused(): boolean {
    return this.closePaneAt(this.focusedPaneId);
  }

  closePaneAt(paneId: PaneId): boolean {
    if (!this.panes.has(paneId)) return false;
    const next = closePane(this.tree, paneId);
    const content = this.panes.get(paneId);
    if (content) {
      try { content.dispose(); } catch { /* ignore */ }
    }
    this.panes.delete(paneId);
    this.clearPaneTitleOverride(paneId);  // VW-B2
    this.events.onPaneClose?.(paneId);
    // VW-U5 — if the closed pane was zoomed, clear the zoom flag so
    // the remaining panes paint normally.
    if (this.zoomedPaneId === paneId) this.zoomedPaneId = null;
    // VW-U5 — forget the closed pane from the alt-tab slot.
    if (this.previousFocusedPaneId === paneId) this.previousFocusedPaneId = null;
    if (next === null) {
      this.state = 'closed';
      this.events.onClose?.();
      return true;
    }
    this.tree = next;
    // Focus the first remaining leaf if the focused pane was closed.
    if (this.focusedPaneId === paneId) {
      const remaining = allPaneIds(this.tree);
      if (remaining.length > 0) this.setFocus(remaining[0]!);
    }
    return true;
  }

  setFocus(paneId: PaneId): boolean {
    if (!this.panes.has(paneId)) return false;
    if (this.focusedPaneId === paneId) return true;
    this.previousFocusedPaneId = this.focusedPaneId;   // VW-U5
    this.focusedPaneId = paneId;
    this.events.onPaneFocus?.(paneId);
    return true;
  }

  /** VW-U5 — toggle zoom on the currently focused pane. When zoomed,
   *  render() paints only the focused pane across the inner rect;
   *  other panes retain their state but are hidden. Calling again
   *  with the same focus clears zoom. Returns the new zoom state. */
  toggleZoom(): boolean {
    if (this.zoomedPaneId === this.focusedPaneId) {
      this.zoomedPaneId = null;
    } else {
      this.zoomedPaneId = this.focusedPaneId;
    }
    return this.zoomedPaneId !== null;
  }

  /** VW-U5 — whether a pane is currently zoomed. */
  isZoomed(): boolean {
    return this.zoomedPaneId !== null;
  }

  /** VW-U5 — jump focus to the pane that was focused right before the
   *  current one. Returns the pane that ended up focused, or null when
   *  there is no recorded previous pane (first-ever focus).
   *
   *  SRF-5 — when the remembered previous pane is output-only (e.g.
   *  a runner pane that swallows keys), we skip to the next
   *  interactive pane if one exists. Mirrors the SP-A window-level
   *  skip so pane-level cycling behaves consistently. Falls through
   *  to the naive target when every alternative is also output-only
   *  (no deadlock). */
  focusLastPane(): PaneId | null {
    const prev = this.previousFocusedPaneId;
    if (!prev || !this.panes.has(prev)) return null;
    if (prev === this.focusedPaneId) return this.focusedPaneId;
    const prevPane = this.panes.get(prev);
    const isOutputOnly = (p: PaneContent | undefined): boolean => p?.focusPolicy === 'output-only';
    if (isOutputOnly(prevPane)) {
      // Find another interactive pane (not current, not prev) before
      // falling back to the naive target.
      for (const [id, content] of this.panes) {
        if (id === this.focusedPaneId) continue;
        if (id === prev) continue;
        if (!isOutputOnly(content)) {
          this.setFocus(id);
          return this.focusedPaneId;
        }
      }
      // No interactive alternative — fall through to naive behavior.
    }
    // setFocus() rotates previousFocusedPaneId → current, so the next
    // call to focusLastPane() swaps back. That's the "alt-tab" feel.
    this.setFocus(prev);
    return this.focusedPaneId;
  }

  focusDirection(dir: Direction): boolean {
    const next = focusNeighbor(this.tree, this.focusedPaneId, dir, this.innerRect());
    if (!next) return false;
    return this.setFocus(next);
  }

  // ─── Key routing ────────────────────────────────────────────────

  onKey(ev: KeyEvent): Action {
    // T3b-c — sync input bar wins when active. Returns passthrough
    // for keys it doesn't recognise (e.g. mouse, unknown ctrl combos)
    // so they can still reach the focused pane as a fallback.
    if (this.syncBar.active) {
      const result = this.handleSyncBarKey(ev);
      if (result === 'consumed') return { type: 'refresh' };
    }
    const content = this.panes.get(this.focusedPaneId);
    if (!content) return { type: 'none' };
    return content.onKey(ev);
  }

  /** VW-U3 — mouse dispatch.
   *
   *  Left click: if the click lands inside a pane rect, focus that
   *  pane. Border / title clicks are a no-op (current focus kept).
   *
   *  Right click: pane title emits `onShowContextMenu` so the host
   *  can route through MenuProvider; pane body/border emits
   *  `onShowSelector` so the host can open the pane/window picker
   *  popup. This is the R6 coexistence rule.
   *
   *  Scroll-up / scroll-down are reserved for future pane scrollback
   *  routing — currently forwarded as-is to the focused pane via
   *  content.onKey-like plumbing if the pane supports it (not wired
   *  in VW-U3). */
  onMouse(ev: DisplayMouseEvent): Action {
    const rect = this.innerRect();
    const insideInner =
      ev.col >= rect.col && ev.col < rect.col + rect.width
      && ev.row >= rect.row && ev.row < rect.row + rect.height;
    const paneId = insideInner ? paneAt(this.tree, rect, ev.col, ev.row) : null;
    if (debug.enabled && ev.type !== 'motion') {
      debug.log('vw.mouse', 'dispatch', {
        windowId: this.id,
        type: ev.type,
        row: ev.row,
        col: ev.col,
        insideInner,
        paneId,
        focusedPaneId: this.focusedPaneId,
      });
    }
    if (isPrimaryDiscreteClickMouseEventType(ev.type)) {
      // VW-A2 — × close-button click takes precedence over pane focus.
      // Geometry lives in closeButtonAt so tests can assert it without
      // mutating state.
      const closeTarget = this.closeButtonAt(ev.col, ev.row);
      if (closeTarget) {
        this.closePaneAt(closeTarget);
        return { type: 'refresh' };
      }
      // VW-A3 — divider hit: arm drag state. The same click also
      // cancels any previous drag so stale state can't persist.
      const divider = insideInner && !this.zoomedPaneId
        ? dividerAt(this.tree, rect, ev.col, ev.row)
        : null;
      if (divider) {
        this.dragDivider = {
          hit: divider,
          lastPointer: divider.axis === 'h' ? ev.col : ev.row,
        };
        return { type: 'none' };
      }
      this.dragDivider = null;
      if (paneId && paneId !== this.focusedPaneId) {
        this.setFocus(paneId);
        const routed = this.routeMouseToPane(paneId, ev);
        if (debug.enabled) {
          debug.log('vw.mouse', 'click.focus-route', {
            windowId: this.id,
            paneId,
            routed: routed.type,
          });
        }
        return routed.type === 'none' ? { type: 'refresh' } : routed;
      }
      if (!paneId) return { type: 'none' };
      const routed = this.routeMouseToPane(paneId, ev);
      if (debug.enabled) {
        debug.log('vw.mouse', 'click.route', {
          windowId: this.id,
          paneId,
          routed: routed.type,
        });
      }
      return routed;
    }
    // VW-A3 — drag motion: while a divider is armed, convert pointer
    // delta into a layout-tree resizePane call. Wheel clicks / releases
    // outside the loop simply clear the state.
    if (isCaptureSessionMouseEventType(ev.type)) {
      if (!this.dragDivider) {
        const target = paneId ?? this.focusedPaneId;
        if (!target) return { type: 'none' };
        return this.routeMouseToPane(target, ev);
      }
      if (isCaptureSessionEndMouseEventType(ev.type)) {
        this.dragDivider = null;
        return { type: 'none' };
      }
      const { hit, lastPointer } = this.dragDivider;
      const pointer = hit.axis === 'h' ? ev.col : ev.row;
      const delta = pointer - lastPointer;
      if (delta === 0) return { type: 'none' };
      const next = resizePane(this.tree, hit.aPaneId, hit.axis, delta, this.innerRect());
      if (next !== this.tree) {
        this.tree = next;
        this.dragDivider = { hit, lastPointer: pointer };
        return { type: 'refresh' };
      }
      // resize refused (MIN size guard) — keep pointer anchor so the
      // user can drag back the other way without a jump.
      return { type: 'none' };
    }
    if (isSecondaryClickMouseEventType(ev.type)) {
      const secondary = secondaryActionTargetAt(this.paneRects(), ev.col, ev.row);
      if (secondary.kind === 'pane-title') {
        this.events.onShowContextMenu?.(this.id, secondary.paneId, ev.col, ev.row);
        return { type: 'none' };
      }
      if (secondary.paneId) {
        const routed = this.routeMouseToPane(secondary.paneId, ev);
        if (routed.type !== 'none') return routed;
      }
      this.events.onShowSelector?.(this.id, secondary.paneId, ev.col, ev.row);
      return { type: 'none' };
    }
    // VW-A1 — scroll-up/down forwards to the pane under the cursor (or
    // the focused pane when the cursor is outside the inner rect). The
    // target pane's PaneContent.onMouse decides what to do with it; static
    // content types (markdown, scratch) omit onMouse entirely and the
    // wheel becomes a no-op. Returning 'refresh' so the dashboard redraws
    // in case the pane updated its own scroll state.
    if (ev.type === 'scroll-up' || ev.type === 'scroll-down') {
      const target = paneId ?? this.focusedPaneId;
      const content = target ? this.panes.get(target) : null;
      if (!content?.onMouse) return { type: 'none' };
      this.routeMouseToPane(target, ev);
      return { type: 'refresh' };
    }
    return { type: 'none' };
  }

  private routeMouseToPane(paneId: PaneId, ev: DisplayMouseEvent): Action {
    const content = this.panes.get(paneId);
    if (!content?.onMouse) return { type: 'none' };
    const paneRect = this.paneRects().find((entry) => entry.paneId === paneId)?.rect;
    if (!paneRect) return { type: 'none' };
    const localEv: DisplayMouseEvent = {
      ...ev,
      row: ev.row - paneRect.row + 1,
      col: ev.col - paneRect.col + 1,
    };
    try {
      const result = content.onMouse(localEv);
      if (debug.enabled && ev.type !== 'motion') {
        debug.log('vw.mouse', 'pane-forward', {
          windowId: this.id,
          paneId,
          absRow: ev.row,
          absCol: ev.col,
          localRow: localEv.row,
          localCol: localEv.col,
          result: result.type,
        });
      }
      return result;
    } catch {
      if (debug.enabled) {
        debug.log('vw.mouse', 'pane-forward-error', {
          windowId: this.id,
          paneId,
          absRow: ev.row,
          absCol: ev.col,
        }, { level: 'error' });
      }
      return { type: 'none' };
    }
  }

  deliverBroadcastToFocused(input: PaneBroadcast): number {
    return this.deliverBroadcastToPane(this.focusedPaneId, input);
  }

  deliverBroadcastToPane(paneId: PaneId, input: PaneBroadcast): number {
    const pane = this.panes.get(paneId);
    if (!pane) return 0;
    if (pane.acceptBroadcast) pane.acceptBroadcast(input);
    else pane.write(input.text);
    return 1;
  }

  deliverBroadcastToAll(input: PaneBroadcast): number {
    let delivered = 0;
    for (const paneId of this.panes.keys()) {
      delivered += this.deliverBroadcastToPane(paneId, input);
    }
    return delivered;
  }

  // ─── Rendering ──────────────────────────────────────────────────

  render(): string {
    const out: string[] = [];
    out.push(this.paintBorder());
    out.push(this.paintInteriorBackground());
    // VW-U5 — zoom path: only the zoomed pane paints, across the full
    // inner rect. Other panes retain their state in the tree so exit
    // is a no-op teardown.
    if (this.zoomedPaneId && this.panes.has(this.zoomedPaneId)) {
      const content = this.panes.get(this.zoomedPaneId)!;
      const rect = this.innerRect();
      try {
        const grid = content.render({
          cols: Math.max(2, rect.width),
          rows: Math.max(2, rect.height),
          focused: true,
        });
        out.push(this.paintPane(rect, grid, this.zoomedPaneId));
      } catch { /* broken pane; skip */ }
    } else {
      const rects = this.paneRects();
      for (const { paneId, rect } of rects) {
        const content = this.panes.get(paneId);
        if (!content) continue;
        try {
          const grid = content.render({
            cols: Math.max(2, rect.width),
            rows: Math.max(2, rect.height),
            focused: paneId === this.focusedPaneId,
          });
          out.push(this.paintPane(rect, grid, paneId));
        } catch { /* broken pane; skip */ }
      }
    }
    if (this.syncBar.active) {
      out.push(this.paintSyncInputBar());
    }
    return out.join('');
  }

  private paintInteriorBackground(): string {
    const rect = this.innerRect();
    if (rect.width < 1 || rect.height < 1) return '';
    const out: string[] = [];
    for (let i = 0; i < rect.height; i++) {
      out.push(
        ansi.moveTo(rect.row + i, rect.col)
        + '\x1b[0m'
        + ' '.repeat(rect.width),
      );
    }
    return out.join('');
  }

  /** Build the ModalSurface representation for the coordinator. */
  asModalSurface(owner: string = 'dashboard'): ModalSurface {
    const surfaceId: SurfaceId = `virtual-window:${this.id}`;
    const self = this;
    return {
      id: surfaceId,
      owner: owner as ModalSurface['owner'],
      kind: 'modal',
      focus: 'owns',
      priority: 500,
      hostChromeProfile: self.getHostChromeProfile(),
      interactionClass: 'workspace',
      backgroundInteractionPolicy: 'block',
      windowRole: 'foreground',
      // IDX-F4 — virtual-window host surfaces sit at the lowest tier;
      // their own child modals (pickers / popups / dialogs) stack
      // above via the normal TIER_ORDER ordering.
      tier: 'vw',
      // VW-U3 — bounds getter now returns THIS window's actual bounds
      // (setBounds still updates `this.bounds`; previous hardcoded
      // `{1,1,80,24}` snapshot was a placeholder that broke any
      // bounds-aware dispatch like hit-testing mouse clicks).
      get bounds() {
        return { ...self.bounds };
      },
      render: () => [],
      paint: () => this.render(),
      cursor: () => this.cursorState(),
      // KX4b — VW is keyboard-exclusive while foregrounded. Any key
      // reaches the focused pane; the pane's Action return is
      // intentionally discarded (the hard-branch router did the same
      // before KX4) so dashboard.ts's displayRoute switch doesn't
      // double-dispatch refresh/focus actions the pane already owns
      // through its direct writes.
      //
      // VW-U2 — **except** Alt-modified keys without Ctrl: those are
      // reserved for dashboard-global VW navigation (Alt+N/P/1..9 fast
      // switch). We let them bubble past the modal surface so the
      // coordinator can match them against registered bindings. The
      // trade-off is that shell users inside a VW lose Alt-only meta
      // shortcuts (e.g. Alt+M in some readline configs); in exchange
      // the user gets a one-keystroke window switcher even while a
      // shell pane holds focus.
      onKey: (ev) => {
        if (ev.alt && !ev.ctrl) return 'passthrough';
        try { this.onKey(ev); } catch { /* isolate pane error */ }
        return 'consumed';
      },
      // VW-U3 — route mouse clicks into the VW. Left click focuses the
      // clicked pane; right-click fires onShowSelector for VW-U4. Errors
      // are isolated just like onKey — a buggy pane shouldn't crash
      // the coordinator.
      onMouse: (ev) => {
        try { return this.onMouse(ev); }
        catch { return { type: 'none' }; }
      },
      dispose: () => { /* close is triggered externally via WindowRegistry */ },
    };
  }

  dispose(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    for (const pane of this.panes.values()) {
      try { pane.dispose(); } catch { /* ignore */ }
    }
    this.panes.clear();
    this.events.onClose?.();
  }

  // ─── Internals ──────────────────────────────────────────────────

  private innerRect(): Rect {
    // Reserve 1 cell on each side for the border + 1 row for title.
    // When the sync input bar is active, shrink the content area by
    // the bar's row count — one per composed line, capped at
    // SYNC_BAR_MAX_ROWS so the bar never eats more than ~a quarter
    // of the window. Pane content clips normally when the bar grows.
    const barRows = this.syncBar.active ? this.syncBarRowCount() : 0;
    return {
      row: this.bounds.row + 1,
      col: this.bounds.col + 1,
      width: Math.max(2, this.bounds.width - 2),
      height: Math.max(2, this.bounds.height - 2 - barRows),
    };
  }

  /** U2 — how many rows the local composer occupies. 1 for a single-line
   *  buffer; lineCount(composed) for multi-line, capped at
   *  WINDOW_LOCAL_COMPOSER_MAX_ROWS so panes keep at least part of the viewport. */
  private localComposerRowCount(): number {
    return this.syncBarRowCount();
  }

  /** Backward-compat internal name kept while older call sites
   *  migrate to the local-composer terminology. */
  private syncBarRowCount(): number {
    const lines = this.syncBar.composed.split('\n').length;
    return Math.min(WINDOW_LOCAL_COMPOSER_MAX_ROWS, Math.max(1, lines));
  }

  // ─── Window-local composer ──────────────────────────────────────

  /** Toggle or set the window-local composer. */
  setLocalComposerActive(active: boolean): void {
    this.setSyncInputBar(active);
  }

  isLocalComposerActive(): boolean {
    return this.isSyncInputBarActive();
  }

  getLocalComposerBuffer(): string {
    return this.getSyncInputBuffer();
  }

  clearLocalComposer(): void {
    this.clearSyncInput();
  }

  getLocalComposerCursor(): number {
    return this.getSyncInputCursor();
  }

  getLocalInputTarget(): LocalInputTarget {
    return this.localInputTarget.kind === 'pane'
      ? { kind: 'pane', paneId: this.localInputTarget.paneId }
      : { kind: this.localInputTarget.kind };
  }

  setLocalInputTarget(target: LocalInputTarget): boolean {
    if (target.kind === 'pane' && !this.panes.has(target.paneId)) return false;
    this.localInputTarget = target.kind === 'pane'
      ? { kind: 'pane', paneId: target.paneId }
      : { kind: target.kind };
    return true;
  }

  consumeLocalComposerMentionTargetToken(): boolean {
    const range = this.localComposerMentionRangeAtCursor();
    if (!range) return false;
    const s = this.syncBar;
    let start = range.start;
    let end = range.end;
    if (s.composed[end] === ' ') end += 1;
    else if (start > 0 && s.composed[start - 1] === ' ') start -= 1;
    s.composed = s.composed.slice(0, start) + s.composed.slice(end);
    s.cursorPos = Math.min(start, s.composed.length);
    s.scrollCol = 0;
    return true;
  }

  listLocalInputTargets(): Array<{ target: LocalInputTarget; label: string; active: boolean }> {
    const out: Array<{ target: LocalInputTarget; label: string; active: boolean }> = [];
    out.push({
      target: { kind: 'focused' },
      label: 'focused pane',
      active: this.localInputTarget.kind === 'focused',
    });
    out.push({
      target: { kind: 'all' },
      label: 'all panes',
      active: this.localInputTarget.kind === 'all',
    });
    for (const [paneId] of this.panes) {
      out.push({
        target: { kind: 'pane', paneId },
        label: this.getPaneDisplayTitle(paneId) || `[${paneId.slice(0, 6)}]`,
        active: this.localInputTarget.kind === 'pane' && this.localInputTarget.paneId === paneId,
      });
    }
    return out;
  }

  /** Toggle or set the sync input bar. When turning ON, the window
   *  reserves a row for the bar and key events flow into it instead
   *  of the focused pane. When turning OFF, keys return to normal
   *  pane routing. Idempotent. */
  setSyncInputBar(active: boolean): void {
    if (this.syncBar.active === active) return;
    this.syncBar = { active, composed: '', scrollCol: 0, cursorPos: 0 };
  }

  isSyncInputBarActive(): boolean {
    return this.syncBar.active;
  }

  getSyncInputBuffer(): string {
    return this.syncBar.composed;
  }

  /** Drop the current composed buffer without submitting. Used by the
   *  Escape handler inside handleSyncBarKey. */
  clearSyncInput(): void {
    this.applySyncBarEditor(inlineEditorClear(this.syncBarEditorState()));
    this.syncBar.scrollCol = 0;
  }

  /** U1 — expose cursor position for tests + potential external UIs
   *  that want to draw an out-of-band indicator. */
  getSyncInputCursor(): number {
    return this.syncBar.cursorPos;
  }

  /** Internal key handler for the sync input bar — returns
   *  'consumed' when the key was handled (prevents fallthrough to
   *  the focused pane). Invoked from onKey() when syncBar.active. */
  private handleSyncBarKey(ev: KeyEvent): 'consumed' | 'passthrough' {
    const name = (ev.name ?? '').toLowerCase();
    const s = this.syncBar;
    if (!ev.ctrl && !ev.alt && name === '@') {
      this.events.onOpenLocalInputTargetPicker?.({
        windowId: this.id,
        seedQuery: this.localComposerMentionRangeAtCursor()?.query ?? undefined,
      });
      return 'consumed';
    }
    // Ctrl+G / Escape → drop the bar entirely (return to pane focus).
    if (name === 'escape' || (ev.ctrl && (name === 'g' || name === 'ㅎ'))) {
      this.setSyncInputBar(false);
      return 'consumed';
    }
    // U2 — Shift+Enter inserts a newline at the cursor (multi-line
    // compose); plain Enter submits the buffer. VW emits submit
    // intent here; pane-specific terminal/newline semantics are
    // handled by PaneContent.acceptBroadcast.
    if (name === 'enter' || name === 'return') {
      if (ev.shift) {
        const next = applyInlineEditorKey(this.syncBarEditorState(), ev, { shiftEnter: 'newline' });
        if (next) this.applySyncBarEditor(next);
        return 'consumed';
      }
      const text = s.composed;
      if (text.length > 0) {
        try {
          const inline = this.resolveInlineLocalInputTarget(text);
          const submitText = inline ? inline.text : text;
          const submitTarget = inline ? inline.target : this.getLocalInputTarget();
          if (inline) this.setLocalInputTarget(inline.target);
          if (this.events.onLocalInputSubmit) {
            if (submitText.length > 0) {
              this.events.onLocalInputSubmit(this.id, {
                broadcast: { mode: 'submit', text: submitText },
                target: submitTarget,
              });
            }
          }
          else if (submitText.length > 0) this.events.onSyncInputSubmit?.(this.id, submitText + '\r');
        }
        catch { /* host-side submit errors don't crash the VW */ }
      }
      s.composed = '';
      s.cursorPos = 0;
      s.scrollCol = 0;
      return 'consumed';
    }
    const next = applyInlineEditorKey(this.syncBarEditorState(), ev);
    if (next !== null) {
      this.applySyncBarEditor(next);
      if (ev.ctrl && name === 'u') s.scrollCol = 0;
      return 'consumed';
    }
    return 'passthrough';
  }

  private syncBarEditorState(): InlineEditorState {
    return {
      text: this.syncBar.composed,
      cursor: this.syncBar.cursorPos,
    };
  }

  private applySyncBarEditor(next: InlineEditorState): void {
    this.syncBar.composed = next.text;
    this.syncBar.cursorPos = next.cursor;
  }

  private localComposerMentionRangeAtCursor():
    | { start: number; end: number; query: string }
    | null {
    const { composed, cursorPos } = this.syncBar;
    if (!composed) return null;
    let start = cursorPos;
    while (start > 0 && !/\s/.test(composed[start - 1]!)) start--;
    let end = cursorPos;
    while (end < composed.length && !/\s/.test(composed[end]!)) end++;
    if (start >= end) return null;
    const token = composed.slice(start, end);
    if (!token.startsWith('@')) return null;
    return { start, end, query: token.slice(1) };
  }

  private resolveInlineLocalInputTarget(text: string):
    | { target: LocalInputTarget; text: string }
    | null {
    const match = text.match(/^\s*@(\S+)(?:\s+([\s\S]*))?$/);
    if (!match) return null;
    const target = this.localInputTargetFromToken(match[1] ?? '');
    if (!target) return null;
    return {
      target,
      text: (match[2] ?? '').trimStart(),
    };
  }

  private localInputTargetFromToken(tokenRaw: string): LocalInputTarget | null {
    const token = tokenRaw.trim().toLowerCase();
    if (!token) return null;
    if (token === 'focused') return { kind: 'focused' };
    if (token === 'all') return { kind: 'all' };
    for (const [paneId] of this.panes) {
      const title = this.getPaneDisplayTitle(paneId);
      if (title && title.trim().toLowerCase() === token) {
        return { kind: 'pane', paneId };
      }
    }
    return null;
  }

  private paintBorder(): string {
    const { row, col, width, height } = this.bounds;
    if (width < 4 || height < 3) return '';
    const innerWidth = width - 2;
    const titleRaw = this.title.length > innerWidth - 6
      ? this.title.slice(0, innerWidth - 7) + '…'
      : this.title;
    const windowLabel = ` ${C.accent(`win:${this.id}`)} ${C.text(titleRaw)} `;
    const vw = visibleWidth(stripAnsi(windowLabel));
    const leftPad = Math.max(1, Math.floor((innerWidth - vw) / 2));
    const rightPad = Math.max(1, innerWidth - vw - leftPad);
    // VW-U1 — when foreground, top border + corners render in accent
    // (blue) so the user can see at a glance which window is active.
    // Sides + bottom stay muted to avoid loud framing.
    const top = this.borderAccent ? C.accent : C.muted;
    const side = C.muted;
    const out: string[] = [];
    out.push(
      ansi.moveTo(row, col) +
      top('╭') +
      top('─'.repeat(leftPad)) +
      windowLabel +
      top('─'.repeat(rightPad)) +
      top('╮'),
    );
    for (let i = 0; i < height - 2; i++) {
      const r = row + 1 + i;
      out.push(ansi.moveTo(r, col) + side('│'));
      out.push(ansi.moveTo(r, col + width - 1) + side('│'));
    }
    out.push(
      ansi.moveTo(row + height - 1, col) +
      side('╰') +
      side('─'.repeat(innerWidth)) +
      side('╯'),
    );
    return out.join('');
  }

  private paintSyncInputBar(): string {
    // U2 — the bar spans syncBarRowCount() rows just above the bottom
    // border. The first row gets the ▶ vw:N prompt; continuation rows
    // use an aligned indent so the composed body stays readable.
    const rowCount = this.syncBarRowCount();
    const topRow = this.bounds.row + this.bounds.height - 1 - rowCount;
    const col = this.bounds.col + 1;
    const width = Math.max(2, this.bounds.width - 2);
    const prompt = C.accent(`▶ vw:${this.id}`) + C.muted(` ${this.localInputTargetLabel()} ▸ `);
    const promptVw = visibleWidth(stripAnsi(prompt));
    const contRaw = ' '.repeat(Math.max(0, promptVw - 2)) + '↪ ';
    const cont = C.muted(contRaw);
    const contVw = visibleWidth(stripAnsi(cont));
    const bodyBudget = Math.max(1, width - promptVw);
    const s = this.syncBar;

    // Compute (line, col) for cursorPos so the rendered caret lands
    // on the right row when composed has embedded newlines.
    const { line: cursorLine, col: cursorColInLine } = positionToLineCol(s.composed, s.cursorPos);
    // Horizontal scroll tracks the current cursor line only. Each
    // line paints independently; only the focused line's content
    // shifts left when needed.
    const lines = s.composed.split('\n');

    const out: string[] = [];
    // Clear every row we're about to paint (prevents stale glyphs
    // when the bar grows/shrinks between frames).
    for (let r = 0; r < rowCount; r++) {
      out.push(ansi.moveTo(topRow + r, col) + ' '.repeat(width) + '\x1b[0m');
    }
    // Window-shift the visible line slice so the cursor stays in view.
    for (let r = 0; r < rowCount; r++) {
      const lineIdx = r < lines.length ? r : -1;
      if (lineIdx < 0) continue;
      const lineText = lines[lineIdx]!;
      const promptPrefix = lineIdx === 0 ? prompt : cont;
      const promptCols = lineIdx === 0 ? promptVw : contVw;
      const budget = Math.max(1, width - promptCols);
      // Only scroll the cursor line; the others render from column 0.
      let start = 0;
      if (lineIdx === cursorLine) {
        start = s.scrollCol;
        if (cursorColInLine < start) start = cursorColInLine;
        if (cursorColInLine >= start + budget) start = cursorColInLine - budget + 1;
        start = Math.max(0, start);
        s.scrollCol = start;
      }
      const slice = lineText.slice(start, start + budget);
      const padded = slice + ' '.repeat(Math.max(0, budget - slice.length));
      out.push(ansi.moveTo(topRow + r, col) + promptPrefix + padded);
    }
    // Paint the cursor cell LAST so it wins over the body paint.
    const cursorRowAbs = topRow + Math.min(rowCount - 1, cursorLine);
    const cursorPrompt = cursorLine === 0 ? promptVw : contVw;
    const cursorCol = col + cursorPrompt + (cursorColInLine - s.scrollCol);
    const underCh = (lines[cursorLine] ?? '')[cursorColInLine] ?? ' ';
    out.push(ansi.moveTo(cursorRowAbs, cursorCol) + '\x1b[7m' + underCh + '\x1b[27m');
    return out.join('');
  }

  private cursorState(): CursorState | null {
    if (this.syncBar.active) return this.localComposerCursorState();
    const rect = this.zoomedPaneCursorRect();
    if (!rect) return null;
    const pane = this.panes.get(rect.paneId);
    if (!pane || typeof pane.cursor !== 'function') return null;
    try {
      return pane.cursor({
        cols: Math.max(2, rect.rect.width),
        rows: Math.max(2, rect.rect.height),
        focused: true,
        row: rect.rect.row,
        col: rect.rect.col,
      });
    } catch {
      return null;
    }
  }

  private zoomedPaneCursorRect():
    | { paneId: PaneId; rect: Rect }
    | null {
    if (this.zoomedPaneId && this.panes.has(this.zoomedPaneId)) {
      return { paneId: this.zoomedPaneId, rect: this.innerRect() };
    }
    const match = this.paneRects().find((it) => it.paneId === this.focusedPaneId);
    return match ? { paneId: match.paneId, rect: match.rect } : null;
  }

  private localComposerCursorState(): CursorState {
    const rowCount = this.syncBarRowCount();
    const topRow = this.bounds.row + this.bounds.height - 1 - rowCount;
    const col = this.bounds.col + 1;
    const width = Math.max(2, this.bounds.width - 2);
    const prompt = C.accent(`▶ vw:${this.id}`) + C.muted(` ${this.localInputTargetLabel()} ▸ `);
    const promptVw = visibleWidth(stripAnsi(prompt));
    const contRaw = ' '.repeat(Math.max(0, promptVw - 2)) + '↪ ';
    const contVw = visibleWidth(contRaw);
    const s = this.syncBar;
    const { line: cursorLine, col: cursorColInLine } = positionToLineCol(s.composed, s.cursorPos);
    const cursorRowAbs = topRow + Math.min(rowCount - 1, cursorLine);
    const cursorPrompt = cursorLine === 0 ? promptVw : contVw;
    const cursorLineText = s.composed.split('\n')[cursorLine] ?? '';
    const visibleBodyCol = visibleWidth(cursorLineText.slice(s.scrollCol, cursorColInLine));
    const cursorCol = col + cursorPrompt + visibleBodyCol;
    return {
      row: cursorRowAbs,
      col: Math.max(col, Math.min(cursorCol, col + width - 1)),
      visible: true,
    };
  }

  private localInputTargetLabel(): string {
    if (this.localInputTarget.kind === 'all') return '@all';
    if (this.localInputTarget.kind === 'focused') return '@focused';
    return `@${this.getPaneDisplayTitle(this.localInputTarget.paneId) || this.localInputTarget.paneId.slice(0, 6)}`;
  }

  private paintPane(rect: Rect, grid: string, paneId: PaneId): string {
    const out: string[] = [];
    const pane = this.panes.get(paneId) ?? null;
    const focused = paneId === this.focusedPaneId;
    const pulseActive = focused && (pane?.isAlive ?? false);
    const pulse = pulseActive ? pulsePhase(this.now()) : null;
    const lines = grid.split('\n');
    for (let i = 0; i < rect.height; i++) {
      const line = lines[i] ?? '';
      // F2 (2026-04-21) — each row ends with CSI K (erase-to-EOL)
      // before moving to the next row, so rows that are narrower than
      // `rect.width` don't leave trailing cells holding residue from
      // the previous foreground (dashboard, another VW). SGR reset
      // before EL ensures the erased cells pick up the default bg.
      out.push(
        ansi.moveTo(rect.row + i, rect.col)
        + line
        + '\x1b[0m\x1b[K',
      );
    }
    // Pane divider: draw a thin horizontal/vertical line separating
    // this pane from its neighbors. Skip when adjacent to window
    // border (border already paints).
    const innerRight = this.bounds.col + this.bounds.width - 2;
    const innerBottom = this.bounds.row + this.bounds.height - 2;
    if (rect.col + rect.width - 1 < innerRight) {
      for (let i = 0; i < rect.height; i++) {
        out.push(ansi.moveTo(rect.row + i, rect.col + rect.width - 1) + C.muted('│'));
      }
    }
    if (rect.row + rect.height - 1 < innerBottom) {
      out.push(
        ansi.moveTo(rect.row + rect.height - 1, rect.col) +
        C.muted('─'.repeat(rect.width)),
      );
    }
    // Pane label on the top border for every pane.
    // Focus changes the chrome treatment, but the pane title itself
    // remains visible for all panes so split layouts (showroom,
    // 2x2, 4x4) preserve local identity without requiring focus.
    {
      const override = this.paneTitleOverrides.get(paneId);
      const displayTitle = this.getPaneDisplayTitle(paneId);
      const baseTitle = override ?? (displayTitle || `[${paneId.slice(0, 6)}]`);
      const vis: PaneVisibility = this.visibilityResolver?.(paneId) ?? 'visible';
      const pulseGlyph = pulseActive ? (pulse === 'A' ? '●' : '○') : '';
      const badge = focused ? composeVisibilityBadge(vis) : '';
      const badgeW = focused ? badgeVisibleWidth(vis) : 0;
      const closeReserve = focused && this.panes.size > 1 && !this.zoomedPaneId && rect.width >= 4 ? 2 : 0;
      const pulseW = pulseGlyph ? 2 : 0;
      const titleBudget = Math.max(0, rect.width - closeReserve - pulseW - (badge ? badgeW + 1 : 0));
      const titleState =
        pulseActive && pulse === 'B'
          ? 'pulse-b'
          : pulseActive
            ? 'pulse-a'
            : focused
              ? 'active'
              : 'inactive';
      const labelCore = paneBorderTitle(baseTitle, titleState, titleBudget);
      const labelWithPulse = pulseGlyph && labelCore ? `${labelCore} ${pulseGlyph}` : labelCore;
      const label = badge && labelWithPulse ? `${labelWithPulse} ${badge}` : labelWithPulse;
      const labelW = Math.min(visibleWidth(label), Math.max(0, rect.width - closeReserve));
      if (labelW > 0) {
        out.push(ansi.moveTo(rect.row, rect.col) + '\x1b[0m' + ' '.repeat(labelW));
        out.push(ansi.moveTo(rect.row, rect.col) + label);
      }
      if (debug.enabled) {
        debug.log('vw.pane.label.paint', paneId.slice(0, 6), {
          paneId, focused, pulse,
          labelWidth: labelW, rectRow: rect.row, rectCol: rect.col,
          baseTitle,
          visibility: vis, badgeW,
        });
      }
    }
    // VW-A2 — close `×` glyph on the focused pane's top-right corner.
    // Hidden for solo panes (use `^B X` to close the whole window) and
    // whenever the pane is zoomed — the × would overlap the zoomed
    // label and users rarely want to close a pane they're focused on
    // in zoom mode anyway.
    if (
      paneId === this.focusedPaneId
      && this.panes.size > 1
      && !this.zoomedPaneId
      && rect.width >= 4
    ) {
      const closeCol = rect.col + rect.width - 2;
      out.push(ansi.moveTo(rect.row, closeCol) + C.error('×'));
    }
    return out.join('');
  }

  /** VW-A2 — hit-test for the per-pane `×` close button. Returns the
   *  pane id whose close button covers (col, row), or null. Kept
   *  separate from onMouse so tests can validate the geometry without
   *  side-effecting focus / close. */
  closeButtonAt(col: number, row: number): PaneId | null {
    if (this.panes.size < 2) return null;
    if (this.zoomedPaneId) return null;
    for (const { paneId, rect } of this.paneRects()) {
      if (paneId !== this.focusedPaneId) continue;
      if (rect.width < 4) continue;
      const closeCol = rect.col + rect.width - 2;
      if (row === rect.row && col === closeCol) return paneId;
    }
    return null;
  }
}

/** U2 — convert an absolute cursor offset into (line, col) given
 *  newline-separated composed buffer. Used by the multi-line paint
 *  path to place the caret in the right row. */
function positionToLineCol(text: string, pos: number): { line: number; col: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === '\n') { line += 1; lineStart = i + 1; }
  }
  return { line, col: pos - lineStart };
}
