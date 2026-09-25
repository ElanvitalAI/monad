// WindowRegistry — VW-P5.
//
// Manages the collection of VirtualWindow instances + wires each to
// the global AddressBook + the DisplayCoordinator's modal stack
// (one foreground modal at a time). Cross-window contract:
//
//   spawn()     — create + register + optionally auto-foreground
//   switchTo()  — pop current foreground, push target
//   close()     — dispose + unregister; auto-switch to a survivor
//   list()      — enumerate for UI pickers + tool discovery
//   current()   — the currently-foreground window
//
// Per-window last-focused-pane memo survives detach → attach, so
// cycling windows keeps each one's focused pane intact.

import {
  VirtualWindow,
  type LocalInputSubmitRequest,
  type LocalInputTargetPickerRequest,
  type VirtualWindowEvents,
} from './virtual-window.js';
import {
  createPaneContent,
  type PaneContent,
  type PaneContentSpec,
  type PaneFactoryDeps,
  type PaneUnsubscribe,
} from './pane-content.js';
import type { AddressBook, WindowId, PaneId, PaneRef, WindowRef } from './addressing.js';
import type { DisplayCoordinator } from '../display/coordinator.js';
import type { ModalBounds } from '../display/modal-stack.js';
import { getGlobalElementRegistry, publishElementEvent } from '../element-registry/index.js';
import { debug } from '../debug/log.js';
import type { HostChromeProfile } from '../display/host-chrome-profile.js';

export const MAX_WINDOWS = 9;

export interface SpawnWindowSpec {
  title: string;
  initialContent: PaneContentSpec;
  bounds?: ModalBounds;
  /** When true (default) the new window becomes foreground. */
  foreground?: boolean;
}

/** SP-A — overrides for a single next()/previous() invocation. The
 *  default predicate lives on `WindowRegistryDeps.skipWindowWhen`;
 *  opts.skipWhen wins per-call when supplied. */
export interface CycleOpts {
  skipWhen?: (w: VirtualWindow) => boolean;
}

export type RegistryEvent =
  | { type: 'window:create'; windowId: WindowId; title: string }
  /** SRF-1 — `spawnTitle` is set to the title the window was spawned
   *  with (before any rename). Callers that own external resources
   *  keyed by spawn title (e.g. RunnerHostFactory 'runner' label) use
   *  it to evict on close without having to look the entry up
   *  separately. Absent only on pathological paths (entry vanished
   *  between resolve and emit — shouldn't happen). */
  | { type: 'window:close';  windowId: WindowId; spawnTitle?: string }
  | { type: 'window:switch'; from?: WindowId; to?: WindowId }
  | { type: 'window:rename'; windowId: WindowId; title: string }
  | { type: 'pane:create';   windowId: WindowId; paneId: PaneId }
  | { type: 'pane:close';    windowId: WindowId; paneId: PaneId }
  | { type: 'pane:focus';    windowId: WindowId; paneId: PaneId };

export interface WindowRegistryDeps {
  addressBook: AddressBook;
  coordinator: DisplayCoordinator;
  paneDeps?: PaneFactoryDeps;
  /** Override ModalBounds for newly-spawned windows. Defaults to
   *  a fullscreen-minus-1 bounds; caller can pass termDimensions. */
  defaultBounds?: (profile?: HostChromeProfile) => ModalBounds;
  /** Per-window local composer submission. The host decides whether
   *  to route it to a local target picker, focused pane, or legacy
   *  broadcast group. */
  onLocalInputSubmit?: (windowId: WindowId, req: LocalInputSubmitRequest) => void;
  /** Backward-compat alias for the original sync-bar submission. */
  onSyncInputSubmit?: (windowId: WindowId, text: string) => void;
  /** VW-U4 — fires when any VW's `onMouse` sees a right-click. Host
   *  is expected to open a pane/window selector popup anchored at
   *  (col, row). When omitted, right-clicks are silently ignored. */
  onShowSelector?: (windowId: WindowId, paneId: PaneId | null, col: number, row: number) => void;
  /** R6 — pane title right-click bridge. Host routes VW title hits
   *  into the context-menu provider path instead of the selector popup. */
  onShowContextMenu?: (windowId: WindowId, paneId: PaneId, col: number, row: number) => void;
  onOpenLocalInputTargetPicker?: (req: LocalInputTargetPickerRequest) => void;
  /** VW-B3/B4 — user-config-backed rename persistence. Omit for
   *  tests or minimal hosts: registry falls back to session-only
   *  behaviour and renames do not survive restart. */
  persistence?: VwRenamePersistence;
  /** SP-A — default predicate consulted by `next()`/`previous()` to
   *  skip windows whose focused pane swallows user keys (e.g. runner
   *  VW with `focusPolicy: 'output-only'`). Predicate returning true
   *  means "skip this window". Fallback when all windows would be
   *  skipped is to fall through and cycle normally (no deadlock).
   *  `switchTo(id)` and Alt+<digit> never consult this — explicit
   *  selection always wins. */
  skipWindowWhen?: (w: VirtualWindow) => boolean;
  /** Bundle B-7-γ — factory that, given a newly-spawned window's id,
   *  returns a resolver mapping paneId → PaneVisibility. The resolver
   *  is plumbed into the VW spec so paintPane can stamp a visibility
   *  badge on the focused pane's label. When null, windows spawn with
   *  no resolver (badge never paints). */
  visibilityResolverFactory?: (windowId: WindowId) => (paneId: PaneId) => import('../panes/visual-state.js').PaneVisibility;
}

export interface VwRenamePersistence {
  /** Return a user-saved rename for a window spawn title, or
   *  undefined if none is stored. Called at spawn time; the returned
   *  title replaces `spec.title` before VW construction. */
  lookupWindowName(spawnTitle: string): string | undefined;
  /** Persist (or clear, on empty) a window rename. Keyed by the
   *  *spawn* title, not the current displayed one — so subsequent
   *  session starts with the same spawn title reapply the rename. */
  saveWindowName(spawnTitle: string, next: string): void;
  /** Same contract but for per-pane overrides keyed on
   *  `${windowSpawnTitle}|${paneContentTitle}`. */
  lookupPaneName(windowSpawnTitle: string, paneContentTitle: string): string | undefined;
  savePaneName(windowSpawnTitle: string, paneContentTitle: string, next: string): void;
}

interface WindowEntry {
  window: VirtualWindow;
  /** Dispose handle from coordinator.pushModal when foreground. */
  modalDispose: null | (() => void);
  /** VW-B3 — the title the window was spawned with, preserved so
   *  that subsequent renames can be persisted against a stable key
   *  even after the displayed title diverges. */
  spawnTitle: string;
}

export class WindowRegistry {
  private entries = new Map<WindowId, WindowEntry>();
  private foregroundId: WindowId | null = null;
  private subscribers = new Set<(ev: RegistryEvent) => void>();
  private paneRenderUnsubs = new Map<PaneId, PaneUnsubscribe>();

  constructor(private readonly deps: WindowRegistryDeps) {}

  private attachPaneRenderBridge(windowId: WindowId, paneId: PaneId, content: PaneContent): void {
    this.detachPaneRenderBridge(paneId);
    const off = content.on('update', () => {
      this.deps.coordinator.requestRender({
        region: `virtual-window:${windowId}` as never,
      });
    });
    this.paneRenderUnsubs.set(paneId, off);
  }

  private detachPaneRenderBridge(paneId: PaneId): void {
    const off = this.paneRenderUnsubs.get(paneId);
    if (!off) return;
    this.paneRenderUnsubs.delete(paneId);
    try { off(); } catch { /* ignore */ }
  }

  /** Mirror a window into the global ElementRegistry so cross-kind
   *  tools (context.*, control.*) can resolve `win:<id>` uniformly.
   *  Handle carries just the kind + stringified id; owners use this
   *  class as the source of truth for resize / close. */
  private syncWindowToElementRegistry(id: WindowId, title: string): void {
    const reg = getGlobalElementRegistry();
    const key = String(id);
    reg.register('window', key, { kind: 'window', id: key });
    publishElementEvent('window', key, 'create', { title });
  }

  private syncWindowUnregisterFromElementRegistry(id: WindowId, window: VirtualWindow): void {
    const reg = getGlobalElementRegistry();
    const key = String(id);
    reg.unregister('window', key);
    publishElementEvent('window', key, 'delete');
    // Cascade: drop any panes still tied to this window.
    try {
      for (const { id: paneId } of window.listPanes()) {
        reg.unregister('pane', paneId);
        publishElementEvent('pane', paneId, 'delete');
      }
    } catch { /* window already disposed */ }
  }

  private syncPaneToElementRegistry(paneId: PaneId, windowId: WindowId, kind: string): void {
    const reg = getGlobalElementRegistry();
    reg.register('pane', paneId, { kind: 'pane', id: paneId });
    publishElementEvent('pane', paneId, 'create', { windowId, kind });
  }

  private syncPaneUnregisterFromElementRegistry(paneId: PaneId): void {
    getGlobalElementRegistry().unregister('pane', paneId);
    publishElementEvent('pane', paneId, 'delete');
  }

  spawn(spec: SpawnWindowSpec): VirtualWindow {
    if (this.entries.size >= MAX_WINDOWS) {
      throw new Error(`max ${MAX_WINDOWS} virtual windows reached`);
    }
    const id = this.deps.addressBook.nextWindowId();
    // VW-B3 — spawn-title is preserved for persistence keying; the
    // *displayed* title may be overridden immediately if the user
    // renamed a same-named window in a prior session.
    const spawnTitle = spec.title;
    const persistedTitle = this.deps.persistence?.lookupWindowName(spawnTitle);
    const displayTitle = persistedTitle ?? spawnTitle;
    const initialContent = createPaneContent(spec.initialContent, this.deps.paneDeps ?? {});
    const bounds = spec.bounds
      ?? this.deps.defaultBounds?.(initialContent.hostChromeProfile)
      ?? { row: 1, col: 1, width: 80, height: 24 };
    if (debug.enabled) {
      debug.log('window.vw.spawn', String(id), {
        id,
        initialContentKind: spec.initialContent?.kind,
        bounds: { ...bounds },
        total: this.entries.size + 1,
      });
    }

    // Hoisted entry so the event callbacks can refer to it. Filled in
    // below — constructor-time events (the root pane's onPaneCreate)
    // run before entry.window is assigned, which is why we guard
    // against it and register the root pane explicitly after
    // construction.
    const entry: WindowEntry = { window: null as unknown as VirtualWindow, modalDispose: null, spawnTitle };

    const events: VirtualWindowEvents = {
      onPaneCreate: (paneId) => {
        if (!entry.window) {
          // Root-pane callback during constructor — entry.window isn't
          // set yet. Handled manually below.
          return;
        }
        const content = entry.window.getPane(paneId);
        if (content) {
          this.deps.addressBook.registerPane({
            id: paneId,
            windowId: id,
            kind: content.kind,
          } as PaneRef);
          this.syncPaneToElementRegistry(paneId, id, content.kind);
          this.attachPaneRenderBridge(id, paneId, content);
          // VW-B4 — apply any persisted pane-title override for
          // split-born panes. Root pane uses the same lookup but
          // earlier (before construction completes) so the
          // addressBook registration already carries the override.
          const override = this.deps.persistence?.lookupPaneName(spawnTitle, content.title);
          if (override) {
            try { entry.window.setPaneTitle(paneId, override); } catch { /* ignore */ }
          }
        }
        this.emit({ type: 'pane:create', windowId: id, paneId });
      },
      onPaneClose: (paneId) => {
        this.detachPaneRenderBridge(paneId);
        this.deps.addressBook.unregisterPane(paneId);
        this.syncPaneUnregisterFromElementRegistry(paneId);
        this.emit({ type: 'pane:close', windowId: id, paneId });
      },
      onPaneFocus: (paneId) => {
        this.emit({ type: 'pane:focus', windowId: id, paneId });
      },
      onClose: () => this.close(id),
      onLocalInputSubmit: this.deps.onLocalInputSubmit,
      onSyncInputSubmit: this.deps.onSyncInputSubmit,
      // VW-U4 / R6 — forward body vs title secondary-action requests
      // to the host on their distinct paths.
      onShowSelector: (windowId, paneId, col, row) => {
        this.deps.onShowSelector?.(windowId, paneId, col, row);
      },
      onShowContextMenu: (windowId, paneId, col, row) => {
        this.deps.onShowContextMenu?.(windowId, paneId, col, row);
      },
      onOpenLocalInputTargetPicker: (req) => {
        this.deps.onOpenLocalInputTargetPicker?.(req);
      },
    };

    const window = new VirtualWindow(
      {
        id,
        title: displayTitle,
        rootContent: initialContent,
        bounds,
        visibilityResolver: this.deps.visibilityResolverFactory?.(id),
      },
      events,
    );
    entry.window = window;

    // VW-B4 — apply any persisted pane-title override to the root
    // pane before anything reads it. Matches the `spawnTitle|rootTitle`
    // key the user rename flow writes. Subsequent split-born panes
    // use the same key format (handled elsewhere).
    const rootOverride = this.deps.persistence?.lookupPaneName(spawnTitle, initialContent.title);
    if (rootOverride) {
      try { window.setPaneTitle(initialContent.id, rootOverride); } catch { /* ignore */ }
    }

    // Register the window itself, then the root pane (the constructor-
    // time onPaneCreate callback was a no-op because entry.window
    // wasn't bound yet).
    this.deps.addressBook.registerWindow({ id, title: displayTitle } as WindowRef);
    this.deps.addressBook.registerPane({
      id: initialContent.id,
      windowId: id,
      kind: initialContent.kind,
    } as PaneRef);
    this.syncWindowToElementRegistry(id, displayTitle);
    this.syncPaneToElementRegistry(initialContent.id, id, initialContent.kind);
    this.attachPaneRenderBridge(id, initialContent.id, initialContent);
    this.entries.set(id, entry);
    this.emit({ type: 'window:create', windowId: id, title: displayTitle });
    // Also emit the root pane:create so subscribers (event bus, LLM
    // observability) see consistent create/close pairs.
    this.emit({ type: 'pane:create', windowId: id, paneId: initialContent.id });

    if (spec.foreground !== false) this.switchTo(id);
    return window;
  }

  close(id: WindowId): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const wasForeground = this.foregroundId === id;
    // SRF-1 — capture spawnTitle before entry.delete so the close
    // event can carry it to downstream resource owners.
    const closedSpawnTitle = entry.spawnTitle;
    const paneIds = entry.window.listPanes().map(({ id: paneId }) => paneId);
    // Pop modal if foreground.
    if (entry.modalDispose) {
      try { this.deps.coordinator.detachWorkspaceSurface(`virtual-window:${id}`); } catch { /* ignore */ }
      entry.modalDispose = null;
    }
    for (const paneId of paneIds) {
      this.detachPaneRenderBridge(paneId);
    }
    try { entry.window.dispose(); } catch { /* ignore */ }
    this.entries.delete(id);
    this.deps.addressBook.unregisterWindow(id);
    this.syncWindowUnregisterFromElementRegistry(id, entry.window);
    this.emit({ type: 'window:close', windowId: id, spawnTitle: closedSpawnTitle });
    if (wasForeground) {
      this.foregroundId = null;
      // Auto-switch to the most recently created survivor.
      const survivors = [...this.entries.keys()].sort((a, b) => b - a);
      if (survivors.length > 0) this.switchTo(survivors[0]!);
      else this.emit({ type: 'window:switch', from: id, to: undefined });
    }
    return true;
  }

  switchTo(id: WindowId): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (this.foregroundId === id) return true;
    const from = this.foregroundId ?? undefined;
    // Detach current foreground.
    if (this.foregroundId !== null) {
      const current = this.entries.get(this.foregroundId);
      if (current?.modalDispose) {
        try { this.deps.coordinator.detachWorkspaceSurface(`virtual-window:${this.foregroundId}`); } catch { /* ignore */ }
        current.modalDispose = null;
      }
      // VW-U1 — clear accent on the departing foreground so if it
      // re-appears in a picker preview later it doesn't look active.
      current?.window.setBorderAccent(false);
    }
    // Push the target as modal.
    const surface = entry.window.asModalSurface();
    const handle = this.deps.coordinator.pushModal(surface);
    entry.modalDispose = handle.dispose;
    entry.window.setBorderAccent(true);   // VW-U1
    // Workspace switch should repaint the full base frame, but avoid
    // force-clearing the terminal first. `force:true` triggers
    // `eraseDown` in tui.render(), which shows up as
    // blank -> content flashes under tmux during VW transitions.
    this.deps.coordinator.requestRender({ region: 'all' });
    this.foregroundId = id;
    if (debug.enabled) {
      debug.log('window.vw.switchTo', String(id), {
        from, to: id, bounds: entry.window.getBounds(),
        forcedFullRedraw: false,
      });
    }
    this.emit({ type: 'window:switch', from, to: id });
    return true;
  }

  current(): VirtualWindow | null {
    if (this.foregroundId === null) return null;
    return this.entries.get(this.foregroundId)?.window ?? null;
  }

  /** S7 — demote the current foreground VW back to dashboard-main
   *  without closing it. This is the host-level seam the dock mover
   *  uses for "go left to main". */
  backgroundCurrent(): boolean {
    if (this.foregroundId === null) return false;
    const id = this.foregroundId;
    const entry = this.entries.get(id);
    if (!entry) {
      this.foregroundId = null;
      this.emit({ type: 'window:switch', from: id, to: undefined });
      return false;
    }
    if (entry.modalDispose) {
      try { this.deps.coordinator.detachWorkspaceSurface(`virtual-window:${id}`); } catch { /* ignore */ }
      entry.modalDispose = null;
    }
    entry.window.setBorderAccent(false);
    this.foregroundId = null;
    this.deps.coordinator.requestRender({ region: 'all' });
    this.emit({ type: 'window:switch', from: id, to: undefined });
    return true;
  }

  /** VW-B1 — rename a window. Pushes through to VW.setTitle and fires
   *  a registry event so pickers / status bar / element-registry can
   *  refresh. Returns false if the window doesn't exist or the
   *  trimmed title is empty.
   *  VW-B3 — persistence.saveWindowName is called so the rename
   *  survives session restart. Keyed by spawnTitle, not current. */
  renameWindow(id: WindowId, title: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const next = title.trim();
    if (!next) return false;
    entry.window.setTitle(next);
    // Mirror the new title into the AddressBook registration so
    // downstream resolvers (context tools) see it.
    try {
      this.deps.addressBook.registerWindow({ id, title: next } as WindowRef);
    } catch { /* ignore */ }
    try { this.deps.persistence?.saveWindowName(entry.spawnTitle, next); } catch { /* ignore */ }
    this.emit({ type: 'window:rename', windowId: id, title: next });
    return true;
  }

  /** VW-B3 — expose spawn title for callers that need to key
   *  persistence externally (e.g. pane rename slash handlers that
   *  live outside the registry). Returns null when unknown. */
  spawnTitleOf(id: WindowId): string | null {
    return this.entries.get(id)?.spawnTitle ?? null;
  }

  /** VW-B4 — rename a pane inside a window. Wraps VirtualWindow.
   *  setPaneTitle and also persists the override keyed by
   *  `${spawnTitle}|${paneContent.title}` so future sessions with the
   *  same spawn title + pane kind replay the rename. Returns false
   *  when the window / pane doesn't exist. An empty `next` clears
   *  both the in-memory override and the persisted entry. */
  renamePane(windowId: WindowId, paneId: PaneId, next: string): boolean {
    const entry = this.entries.get(windowId);
    if (!entry) return false;
    const content = entry.window.getPane(paneId);
    if (!content) return false;
    const trimmed = next.trim();
    const ok = entry.window.setPaneTitle(paneId, trimmed);
    if (!ok) return false;
    try {
      this.deps.persistence?.savePaneName(entry.spawnTitle, content.title, trimmed);
    } catch { /* ignore */ }
    return true;
  }

  list(): VirtualWindow[] {
    return [...this.entries.values()].map(e => e.window);
  }

  get(id: WindowId): VirtualWindow | null {
    return this.entries.get(id)?.window ?? null;
  }

  subscribe(cb: (ev: RegistryEvent) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  /** Cycle foreground to the next higher id (wraps).
   *  SP-A — when a `skipWhen` predicate is configured (via deps or
   *  opts), windows where predicate(w) === true are skipped during
   *  scan. If every window would be skipped we fall back to the
   *  naive next-id to avoid deadlock. */
  next(opts?: CycleOpts): boolean {
    return this.cycle(1, opts);
  }

  /** Cycle foreground to the next lower id (wraps). */
  previous(opts?: CycleOpts): boolean {
    return this.cycle(-1, opts);
  }

  private cycle(dir: 1 | -1, opts?: CycleOpts): boolean {
    const ids = [...this.entries.keys()].sort((a, b) => a - b);
    if (ids.length === 0) return false;
    const startIdx = this.foregroundId === null
      ? (dir === 1 ? -1 : ids.length)
      : ids.indexOf(this.foregroundId);
    const skip = opts?.skipWhen ?? this.deps.skipWindowWhen;
    if (skip) {
      for (let step = 1; step <= ids.length; step++) {
        const idx = ((startIdx + dir * step) % ids.length + ids.length) % ids.length;
        const w = this.entries.get(ids[idx]!)?.window;
        if (w && !skip(w)) return this.switchTo(ids[idx]!);
      }
      // All windows flagged skip — fall through to naive behaviour.
    }
    const idx = startIdx < 0
      ? (dir === 1 ? 0 : ids.length - 1)
      : (((startIdx + dir) % ids.length) + ids.length) % ids.length;
    return this.switchTo(ids[idx]!);
  }

  private emit(ev: RegistryEvent): void {
    for (const cb of this.subscribers) {
      try { cb(ev); } catch { /* isolate */ }
    }
  }
}
