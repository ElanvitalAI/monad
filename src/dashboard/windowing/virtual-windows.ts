// Dashboard-level singleton for virtual-windows — T1-P1.
//
// Mirrors the shape of dashboard-terminal-session.ts: the dashboard
// calls initDashboardVirtualWindows(opts) once at startup, and the
// rest of the app (skill-runner, tool dispatchers, navigation chord)
// reaches the shared instance through the getter. Kept in its own
// module so the singleton state can be reset between unit tests.
//
// Wiring done here in one place:
//
//   • AddressBook + VWEventBus + WindowRegistry construction
//   • registry → bus event promotion (subscribers see window/pane
//     lifecycle events on a unified stream alongside pane I/O)
//   • registerPaneContentLookup — PaneCapture resolves ids to
//     live PaneContent instances via the registry
//   • initVirtualWindowTools — skill-runner's tool dispatchers see
//     the registry/bus/book singletons
//   • NavigationRouter construction with host-provided callbacks
//     (onPicker, onNewWindow, onSplit, onHelp, onCloseWindow) so
//     dashboard.ts stays in charge of UI-level responses

import { createAddressBook, type AddressBook } from '../../virtual-windows/addressing.js';
import { createVWEventBus, type VWEventBus } from '../../virtual-windows/event-bus.js';
import { WindowRegistry, type VwRenamePersistence } from '../../virtual-windows/window-registry.js';
import { getDefaultAgentRoomRegistry } from '../../agent-room/registry.js';
import {
  getUserConfig,
  saveUserConfig,
  setVwWindowName,
  setVwPaneName,
  vwPaneKey,
} from '../../user-config.js';
import {
  createNavigationRouter,
  type NavigationRouter,
  type NavCallbacks,
} from '../../virtual-windows/navigation.js';
import {
  initVirtualWindowTools,
  _resetVirtualWindowToolsForTesting,
} from '../../skills/tools/virtual-windows.js';
import { registerPaneContentLookup } from '../../virtual-windows/pane-capture.js';
import type { PaneFactoryDeps } from '../../virtual-windows/pane-content.js';
import type { DisplayCoordinator } from '../../display/coordinator.js';
import type { ModalBounds } from '../../display/modal-stack.js';
import type {
  LocalInputSubmitRequest,
  LocalInputTargetPickerRequest,
  VirtualWindow,
} from '../../virtual-windows/virtual-window.js';

export interface DashboardVirtualWindows {
  registry: WindowRegistry;
  bus: VWEventBus;
  book: AddressBook;
  router: NavigationRouter;
}

export interface InitDashboardVirtualWindowsOpts {
  coordinator: DisplayCoordinator;
  paneDeps?: PaneFactoryDeps;
  callbacks?: NavCallbacks;
  defaultBounds?: () => ModalBounds;
  chordTimeoutMs?: number;
  /** T1-P2 — approver for PaneInject. When omitted the tool refuses
   *  (fail-closed) so headless paths can't mutate panes silently. */
  injectApprover?: (req: {
    paneAddr: string; paneKind: string; previewBytes: string; totalBytes: number;
  }) => Promise<boolean>;
  /** T1-P2 — approver for BroadcastPanes. Same fail-closed contract. */
  broadcastApprover?: (req: {
    targets: string[]; previewBytes: string; totalBytes: number;
  }) => Promise<boolean>;
  /** Per-window local composer submission. Host decides the routing
   *  policy; current showroom path still maps to window-local
   *  broadcast groups until picker targeting lands. */
  onLocalInputSubmit?: (windowId: number, req: LocalInputSubmitRequest) => void;
  /** Backward-compat alias for the original sync-bar naming. */
  onSyncInputSubmit?: (windowId: number, text: string) => void;
  /** VW-U4 — fires when a VW sees a right-click. Host opens the
   *  pane/window selector popup anchored at (col, row). */
  onShowSelector?: (windowId: number, paneId: string | null, col: number, row: number) => void;
  /** R6 — pane title right-click goes through the menu-provider path
   *  rather than the selector popup path. */
  onShowContextMenu?: (windowId: number, paneId: string, col: number, row: number) => void;
  onOpenLocalInputTargetPicker?: (req: LocalInputTargetPickerRequest) => void;
  /** B-7-α — extra skip predicate OR-composed with the built-in
   *  `!w.hasInteractableFocus()` default. Intended for the dashboard
   *  to plug in a PaneVisualStateStore-driven Alt+N skip rule (see
   *  `src/panes/alt-skip-predicate.ts`). When either predicate flags
   *  a window, cycling skips it. Explicit selection (`^B <digit>`,
   *  Alt+<digit>, picker) still bypasses both. */
  extraSkipWindowWhen?: (w: VirtualWindow) => boolean;
  /** Bundle B-7-γ — factory that builds a paneId → PaneVisibility
   *  resolver for each newly-spawned window. Passed through to the
   *  WindowRegistry which plumbs it into each VirtualWindow's
   *  paintPane. Omit to skip badge rendering. */
  visibilityResolverFactory?: (windowId: number) => (paneId: string) => import('../../panes/visual-state.js').PaneVisibility;
}

let state: DashboardVirtualWindows | null = null;

export function initDashboardVirtualWindows(
  opts: InitDashboardVirtualWindowsOpts,
): DashboardVirtualWindows {
  const book = createAddressBook();
  const bus = createVWEventBus({ addressBook: book });
  const registry = new WindowRegistry({
    addressBook: book,
    coordinator: opts.coordinator,
    paneDeps: opts.paneDeps,
    defaultBounds: opts.defaultBounds,
    onLocalInputSubmit: opts.onLocalInputSubmit,
    onSyncInputSubmit: opts.onSyncInputSubmit,
    onShowSelector: opts.onShowSelector,
    onShowContextMenu: opts.onShowContextMenu,
    onOpenLocalInputTargetPicker: opts.onOpenLocalInputTargetPicker,
    persistence: buildUserConfigPersistence(),
    // SP-A — cycle past windows whose focused pane is output-only
    // (runner VWs etc.). Explicit selection (`^B <n>` digit,
    // Alt+<digit>, picker) bypasses this predicate. B-7-α composes
    // the caller-supplied `extraSkipWindowWhen` (store-driven Alt+N
    // skip) as an OR — either flag triggers skip.
    skipWindowWhen: (w) =>
      !w.hasInteractableFocus() || (opts.extraSkipWindowWhen?.(w) ?? false),
    // B-7-γ — propagate the visibility resolver factory (if any) so
    // paintPane can stamp a store-driven badge on focused pane labels.
    visibilityResolverFactory: opts.visibilityResolverFactory,
  });

  // Promote registry lifecycle events onto the bus so LLM subscribers
  // and AI-visible event streams see one unified source. T2-P3 —
  // also bridge each pane's own observer stream ('update' + 'output')
  // so downstream consumers (VWSubscribe / VWCollect, plugin hooks)
  // see content changes without polling capturePane themselves.
  const paneBridges = new Map<string, Array<() => void>>();
  registry.subscribe((ev) => {
    switch (ev.type) {
      case 'window:create':
        bus.emit({ type: 'window:create', windowId: ev.windowId, title: ev.title });
        return;
      case 'window:close':
        void getDefaultAgentRoomRegistry().disposeByWindowId(ev.windowId);
        bus.emit({ type: 'window:close', windowId: ev.windowId });
        return;
      case 'window:switch':
        bus.emit({ type: 'window:switch', from: ev.from, to: ev.to });
        return;
      case 'pane:create': {
        const win = registry.get(ev.windowId);
        const content = win?.getPane(ev.paneId) ?? null;
        bus.emit({
          type: 'pane:create',
          addr: `pane:${ev.paneId}`,
          kind: content?.kind ?? 'unknown',
        });
        if (content) {
          const addr = `pane:${ev.paneId}`;
          const unsubs: Array<() => void> = [];
          unsubs.push(content.on('output', (payload) => {
            if (typeof payload === 'string' && payload.length > 0) {
              bus.emit({ type: 'pane:output', addr, chunk: payload });
            }
          }));
          // 'update' has no payload — promote as empty-chunk pane:output
          // so subscribers can drive "this pane changed" indicators
          // without needing to capture the whole grid each frame. Bus
          // rate-limits to 128 events/sec, which keeps terminal-render
          // floods from drowning out other signals.
          unsubs.push(content.on('update', () => {
            bus.emit({ type: 'pane:output', addr, chunk: '' });
          }));
          paneBridges.set(ev.paneId, unsubs);
        }
        return;
      }
      case 'pane:close': {
        const unsubs = paneBridges.get(ev.paneId);
        if (unsubs) {
          for (const u of unsubs) { try { u(); } catch { /* isolate */ } }
          paneBridges.delete(ev.paneId);
        }
        bus.emit({ type: 'pane:close', addr: `pane:${ev.paneId}` });
        return;
      }
      case 'pane:focus':
        bus.emit({ type: 'pane:focus', addr: `pane:${ev.paneId}` });
        return;
    }
  });

  // PaneCapture resolves a pane id to the live PaneContent through
  // the registry rather than owning a separate map.
  registerPaneContentLookup((paneId) => {
    const pane = book.resolvePane(paneId);
    if (!pane) return null;
    const window = registry.get(pane.windowId);
    return window?.getPane(paneId) ?? null;
  });

  initVirtualWindowTools(registry, bus, book, opts.paneDeps ?? {}, {
    injectApprover: opts.injectApprover,
    broadcastApprover: opts.broadcastApprover,
  });

  const router = createNavigationRouter({
    registry,
    callbacks: opts.callbacks,
    chordTimeoutMs: opts.chordTimeoutMs,
  });

  state = { registry, bus, book, router };
  return state;
}

export function getDashboardVirtualWindows(): DashboardVirtualWindows {
  if (!state) {
    throw new Error(
      'dashboard virtual windows not initialized — call initDashboardVirtualWindows first',
    );
  }
  return state;
}

export function _resetDashboardVirtualWindowsForTesting(): void {
  if (state) {
    registerPaneContentLookup(() => null);
    _resetVirtualWindowToolsForTesting();
  }
  state = null;
}

// ── VW-B3/B4 — user-config-backed rename persistence ─────────────

function buildUserConfigPersistence(): VwRenamePersistence {
  return {
    lookupWindowName(spawnTitle) {
      try { return getUserConfig().vw.windowNames[spawnTitle]; }
      catch { return undefined; }
    },
    saveWindowName(spawnTitle, next) {
      try { saveUserConfig(setVwWindowName(getUserConfig(), spawnTitle, next)); }
      catch { /* best-effort; rename still works in-memory */ }
    },
    lookupPaneName(windowSpawnTitle, paneContentTitle) {
      try { return getUserConfig().vw.paneNames[vwPaneKey(windowSpawnTitle, paneContentTitle)]; }
      catch { return undefined; }
    },
    savePaneName(windowSpawnTitle, paneContentTitle, next) {
      try {
        saveUserConfig(setVwPaneName(
          getUserConfig(),
          vwPaneKey(windowSpawnTitle, paneContentTitle),
          next,
        ));
      } catch { /* best-effort */ }
    },
  };
}
