import { stripAnsi } from '../tui.js';
import { writeClipboardDetailed } from '../clipboard/index.js';
import { debug } from '../debug/log.js';
import { Printer } from '../ui/printer.js';
import { SidebarTabSurface, type SidebarTabItem } from '../ui/widgets/sidebar-tab-surface.js';
import { resolveAcpSidebarShellPresentation } from '../ui/chrome/sidebar-shell-presentation.js';
import {
  isClickIntentMouseEventType,
  isPrimaryClickMouseEventType,
  toWidgetMouseEventType,
  type MouseEvent,
} from '../ui/mouse-events.js';
import { cellWidth } from '../ui/printer.js';
import { ContextMenu, computePlacement } from '../ui/widgets/context-menu.js';
import { mintPaneId } from '../virtual-windows/addressing.js';
import type {
  PaneBroadcast,
  PaneContent,
  PaneRenderCtx,
  PaneUnsubscribe,
} from '../virtual-windows/pane-content.js';
import {
  isDiscreteClickMouseEventType,
  isSecondaryClickMouseEventType,
  type Action,
  type KeyEvent,
  type DisplayMouseEvent,
} from '../display/types.js';
import { globalDualRoleManager, type DualRoleManager } from './dual-role-manager.js';
import {
  backgroundToStub,
  globalBackgroundManager,
  type BackgroundManager,
} from './background-manager.js';
import type { AcpSessionStub } from '../session/card.js';
import { buildAcpChannelSidebarItems, buildStubSnapshot } from './channel-browser-catalog.js';
import {
  resolvePrimaryActionForStub,
  type AcpChannelPrimaryAction,
} from './channel-browser-catalog.js';
import { ACP_CHANNEL_BROWSER_COPY } from './channel-browser-copy.js';
import { globalAcpEventRouter, type AcpEventRouter } from './event-router.js';
import {
  globalAcpSessionPersistence,
  type AcpSessionPersistence,
  type PersistedAcpSession,
} from './session-persistence.js';
import {
  dispatchAcpSessionJoin,
  dispatchAcpSessionResume,
} from '../skills/tools/acp-session.js';

export interface AcpChannelBrowserViewOptions {
  title?: string;
  footerHint?: string;
  initialActiveId?: string;
  scope?: 'all' | 'browser' | 'history';
  onActivateItem?: (active: SidebarTabItem, index: number, via: 'double-click') => void;
  onReorderItem?: (fromIndex: number, toIndex: number, active: SidebarTabItem) => void;
  orderedIds?: readonly string[];
}

export interface AcpChannelBrowserPaneContentSpec {
  kind: 'acp-shell';
  title?: string;
  scope?: 'all' | 'browser' | 'history';
}

export interface AcpChannelBrowserDeps {
  dualRoleManager: Pick<DualRoleManager, 'listAsSidebarStubs' | 'onChange'>;
  backgroundManager: Pick<BackgroundManager, 'list' | 'status' | 'onCreate' | 'onStateChange'>;
  eventRouter: Pick<AcpEventRouter, 'getStream'>;
  persistence: Pick<AcpSessionPersistence, 'list' | 'load' | 'onChange'>;
  runPrimaryAction?: (action: AcpChannelPrimaryAction, stub: AcpSessionStub) => Promise<string>;
  actionStatus?: (id: string) => string | null;
}

type AcpContextMenuAction =
  | 'primary'
  | 'copy-session-id'
  | 'copy-backend-session-id'
  | 'copy-summary'
  | 'copy-excerpt';

interface AcpContextMenuState {
  menu: ContextMenu<AcpContextMenuAction>;
  stubId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_DEPS: AcpChannelBrowserDeps = {
  dualRoleManager: globalDualRoleManager(),
  backgroundManager: globalBackgroundManager(),
  eventRouter: globalAcpEventRouter(),
  persistence: globalAcpSessionPersistence(),
};

export function createAcpChannelBrowserView(
  opts: AcpChannelBrowserViewOptions = {},
  deps: AcpChannelBrowserDeps = DEFAULT_DEPS,
): SidebarTabSurface {
  const chrome = resolveAcpSidebarShellPresentation();
  const stubs = applyAcpChannelOrder(listAcpChannelStubs(deps, opts.scope ?? 'all'), opts.orderedIds);
  if (debug.enabled) {
    debug.log('acp.shell', 'view-build', {
      title: opts.title ?? chrome.title,
      channels: stubs.length,
      initialActiveId: opts.initialActiveId ?? null,
    });
  }
  return new SidebarTabSurface({
    title: opts.title ?? chrome.title,
    compactTitle: chrome.compactTitle,
    railTitle: chrome.railTitle,
    footerHint: opts.footerHint ?? chrome.footerHint,
    compactFooterHint: chrome.compactFooterHint,
    emptyState: ACP_CHANNEL_BROWSER_COPY.emptyResidentState,
    debugCategory: 'acp.shell',
    badgeMaxWidth: chrome.badgeMaxWidth,
    initialActiveId: opts.initialActiveId,
    onActivateItem: opts.onActivateItem,
    items: buildAcpChannelSidebarItems(stubs, {
      status: (id) => deps.backgroundManager.status(id),
      getBlocks: (id) => deps.eventRouter.getStream(id).snapshot(),
      loadPersisted: (id) => deps.persistence.load(id),
      actionStatus: (id) => deps.actionStatus?.(id) ?? null,
    }, { preserveOrder: true }),
    onReorderItem: opts.onReorderItem,
  });
}

export function createAcpChannelBrowserPaneContent(
  spec: AcpChannelBrowserPaneContentSpec,
  deps: AcpChannelBrowserDeps = DEFAULT_DEPS,
): PaneContent {
  const obs = createObserver();
  let alive = true;
  let lastCtx: PaneRenderCtx = { cols: 40, rows: 12, focused: true };
  const actionStatus = new Map<string, string>();
  let orderedIds: string[] = [];
  let contextMenu: AcpContextMenuState | null = null;
  const depsWithActionStatus: AcpChannelBrowserDeps = {
    ...deps,
    actionStatus: (id) => actionStatus.get(id) ?? null,
  };
  const handleRailActivation = (active: SidebarTabItem): void => {
    const stub = resolveStubById(active.id, deps);
    if (stub) firePrimaryAction(stub);
  };
  let view = createAcpChannelBrowserView({
    title: spec.title ?? 'ACP Channels',
    scope: spec.scope ?? 'all',
    onActivateItem: handleRailActivation,
    onReorderItem: (fromIndex, toIndex) => {
      const current = applyAcpChannelOrder(listAcpChannelStubs(deps, spec.scope ?? 'all'), orderedIds);
      const moved = current[fromIndex];
      if (!moved || fromIndex === toIndex) return;
      const next = [...current];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      orderedIds = next.map((stub) => stub.id);
      actionStatus.set(moved.id, `Reordered to rail slot ${toIndex + 1}`);
      rebuild();
    },
    orderedIds,
  }, depsWithActionStatus);
  let activeId: string | undefined = view.activeItem?.id;

  const renderLines = (ctx: PaneRenderCtx): string[] => {
    view.layout({ width: Math.max(1, ctx.cols), height: Math.max(1, ctx.rows) });
    const printer = Printer.create({
      width: Math.max(1, ctx.cols),
      height: Math.max(1, ctx.rows),
      focused: ctx.focused,
    });
    view.draw(printer);
    if (contextMenu) {
      contextMenu.menu.layout({ width: contextMenu.width, height: contextMenu.height });
      contextMenu.menu.draw(printer.sub(contextMenu.x, contextMenu.y, contextMenu.width, contextMenu.height, { focused: ctx.focused }));
    }
    return printer.lines();
  };

  const rebuild = (): void => {
    activeId = view.activeItem?.id ?? activeId;
    const stubs = applyAcpChannelOrder(listAcpChannelStubs(deps, spec.scope ?? 'all'), orderedIds);
    orderedIds = stubs.map((stub) => stub.id);
    view = createAcpChannelBrowserView({
      title: spec.title ?? 'ACP Channels',
      scope: spec.scope ?? 'all',
      initialActiveId: activeId,
      onActivateItem: handleRailActivation,
      onReorderItem: (fromIndex, toIndex) => {
        const current = applyAcpChannelOrder(listAcpChannelStubs(deps, spec.scope ?? 'all'), orderedIds);
        const moved = current[fromIndex];
        if (!moved || fromIndex === toIndex) return;
        const next = [...current];
        next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        orderedIds = next.map((stub) => stub.id);
        actionStatus.set(moved.id, `Reordered to rail slot ${toIndex + 1}`);
        rebuild();
      },
      orderedIds,
    }, depsWithActionStatus);
    if (debug.enabled) {
      debug.log('acp.shell', 'rebuild', {
        title: spec.title ?? 'ACP Channels',
        activeId: activeId ?? null,
        channels: stubs.length,
      });
    }
    obs.emit();
  };

  const stopDrm = deps.dualRoleManager.onChange((ev) => {
    if (debug.enabled) {
      debug.log('acp.shell', 'registry-change', {
        source: 'dual-role',
        kind: ev.kind,
        sessionId: ev.sessionId,
      });
    }
    rebuild();
  });
  const stopBgState = deps.backgroundManager.onStateChange((rec, prev) => {
    if (debug.enabled) {
      debug.log('acp.shell', 'registry-change', {
        source: 'background-state',
        id: rec.id,
        prev,
        next: rec.state,
      });
    }
    rebuild();
  });
  const stopBgCreate = deps.backgroundManager.onCreate((rec) => {
    if (debug.enabled) {
      debug.log('acp.shell', 'registry-change', {
        source: 'background-create',
        id: rec.id,
        state: rec.state,
        backendId: rec.backendId,
      });
    }
    rebuild();
  });
  const stopPersistence = deps.persistence.onChange((_ev) => {
    if (debug.enabled) {
      debug.log('acp.shell', 'registry-change', {
        source: 'persistence',
      });
    }
    rebuild();
  });

  const firePrimaryAction = (stub: AcpSessionStub): void => {
    const persisted = deps.persistence.load(stub.id);
    const action = resolvePrimaryActionForStub(
      stub,
      deps.backgroundManager.status(stub.id),
      persisted,
    );
    const runner = deps.runPrimaryAction ?? runDefaultAcpChannelPrimaryAction;
    actionStatus.set(stub.id, `Running · ${action.label}`);
    rebuild();
    void runner(action, stub)
      .then((message) => {
        actionStatus.set(stub.id, message);
        rebuild();
      })
      .catch((error) => {
        actionStatus.set(stub.id, `Error · ${String((error as Error)?.message ?? error)}`);
        rebuild();
      });
    if (debug.enabled) {
      debug.log('acp.shell', 'pane-action-dispatch', {
        actionId: action.id,
        activeId: stub.id,
      });
    }
  };

  const closeContextMenu = (): void => {
    if (!contextMenu) return;
    contextMenu = null;
    obs.emit();
  };

  const runContextMenuAction = (action: AcpContextMenuAction, stub: AcpSessionStub): void => {
    if (action === 'primary') {
      firePrimaryAction(stub);
      return;
    }
    const persisted = deps.persistence.load(stub.id);
    const snapshot = buildStubSnapshot(
      stub,
      deps.backgroundManager.status(stub.id),
      {
        status: (id) => deps.backgroundManager.status(id),
        getBlocks: (id) => deps.eventRouter.getStream(id).snapshot(),
        loadPersisted: (id) => deps.persistence.load(id),
        actionStatus: (id) => depsWithActionStatus.actionStatus?.(id) ?? null,
      },
      persisted,
    );
    const text = action === 'copy-session-id'
      ? stub.id
      : action === 'copy-backend-session-id'
        ? String(stub.meta?.['backendSessionId'] ?? '')
        : action === 'copy-summary'
          ? snapshot.summaryBody
          : snapshot.excerpt;
    if (!text) {
      actionStatus.set(stub.id, 'Error · No snapshot text available');
      rebuild();
      return;
    }
    actionStatus.set(stub.id, `Running · ${labelForContextMenuAction(action)}`);
    rebuild();
    void writeClipboardDetailed(text)
      .then((result) => {
        actionStatus.set(
          stub.id,
          result.ok
            ? `Copied identifier via ${result.via}`
            : `Error · clipboard ${result.note ?? 'write failed'}`,
        );
        rebuild();
      })
      .catch((error) => {
        actionStatus.set(stub.id, `Error · ${String((error as Error)?.message ?? error)}`);
        rebuild();
      });
  };

  const openContextMenu = (stub: AcpSessionStub, localCol: number, localRow: number): void => {
    const items = buildContextMenuItemsForStub(stub);
    const menu = new ContextMenu<AcpContextMenuAction>({
      title: 'ACP lane',
      items,
      onPick: (value) => {
        closeContextMenu();
        runContextMenuAction(value, stub);
      },
      onCancel: () => closeContextMenu(),
    });
    const desiredWidth = Math.max(18, Math.min(42, widestContextMenuLabel(items) + 6));
    const desiredHeight = Math.min(items.length + 3, 10);
    const placement = computePlacement(
      { x: Math.max(0, localCol - 1), y: Math.max(0, localRow - 1) },
      { width: desiredWidth, height: desiredHeight },
      { width: Math.max(1, lastCtx.cols), height: Math.max(1, lastCtx.rows) },
    );
    contextMenu = {
      menu,
      stubId: stub.id,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    };
    obs.emit();
  };

  return {
    id: mintPaneId(),
    kind: spec.kind,
    title: spec.title ?? 'ACP Channels',
    focusPolicy: 'interactive',
    start() {
      if (debug.enabled) {
        debug.log('acp.shell', 'pane-start', {
          title: spec.title ?? 'ACP Channels',
          channels: listAcpChannelStubs(deps, spec.scope ?? 'all').length,
        });
      }
    },
    stop() {
      alive = false;
      if (debug.enabled) debug.log('acp.shell', 'pane-stop', { title: spec.title ?? 'ACP Channels' });
    },
    render(ctx) {
      lastCtx = ctx;
      return renderLines(ctx).join('\n');
    },
    onKey(ev: KeyEvent): Action {
      if (contextMenu) {
        const result = contextMenu.menu.onEvent(ev);
        if (result.kind === 'consumed') {
          result.callback?.();
          return { type: 'refresh' };
        }
      }
      if (ev.ctrl && ev.name === 'enter') {
        const stub = resolveActiveStub(activeId, deps, spec.scope ?? 'all');
        if (stub) {
          firePrimaryAction(stub);
          return { type: 'refresh' };
        }
      }
      const result = view.onEvent(ev);
      if (result.kind === 'consumed') {
        result.callback?.();
        activeId = view.activeItem?.id ?? activeId;
        if (debug.enabled) {
          debug.log('acp.shell', 'pane-key-consumed', {
            key: ev.name,
            activeId: activeId ?? null,
            activeIndex: view.activeIndex,
          });
        }
        obs.emit();
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
    onMouse(ev: DisplayMouseEvent): Action {
      if (contextMenu) {
        const hitMenu = (
          ev.col >= contextMenu.x + 1
          && ev.col < contextMenu.x + contextMenu.width + 1
          && ev.row >= contextMenu.y + 1
          && ev.row < contextMenu.y + contextMenu.height + 1
        );
        if (hitMenu) {
          const menuResult = contextMenu.menu.onMouse?.({
            type: toWidgetMouseEventType(ev.type),
            x: ev.col - contextMenu.x - 1,
            y: ev.row - contextMenu.y - 1,
            absX: ev.col - 1,
            absY: ev.row - 1,
            shift: ev.shift,
            ctrl: ev.ctrl,
            alt: ev.alt,
          });
          if (menuResult?.kind === 'consumed') {
            menuResult.callback?.();
            return { type: 'refresh' };
          }
        }
        contextMenu = null;
        if (!isDiscreteClickMouseEventType(ev.type)) {
          obs.emit();
          return { type: 'refresh' };
        }
      }
      const localX = Math.max(0, ev.col - 1);
      const localY = Math.max(0, ev.row - 1);
      const widgetEvent: MouseEvent = {
        type: toWidgetMouseEventType(ev.type),
        x: localX,
        y: localY,
        absX: localX,
        absY: localY,
        shift: ev.shift,
        ctrl: ev.ctrl,
        alt: ev.alt,
      };
      const result = view.onMouse(widgetEvent);
      if (result.kind === 'consumed') {
        result.callback?.();
        activeId = view.activeItem?.id ?? activeId;
        if (isSecondaryClickMouseEventType(ev.type)) {
          const stub = resolveActiveStub(activeId, deps, spec.scope ?? 'all');
          if (stub) {
            openContextMenu(stub, ev.col, ev.row);
            return { type: 'refresh' };
          }
        }
        if (
          isClickIntentMouseEventType(ev.type)
          && !isPrimaryClickMouseEventType(ev.type)
          && view.lastMouseFocusArea === 'detail'
        ) {
          const stub = resolveActiveStub(activeId, deps, spec.scope ?? 'all');
          if (stub) firePrimaryAction(stub);
        }
        if (debug.enabled && ev.type !== 'motion') {
          debug.log('acp.shell', 'pane-mouse-consumed', {
            type: ev.type,
            row: ev.row,
            col: ev.col,
            activeId: activeId ?? null,
          });
        }
        obs.emit();
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
    write(_bytes) {},
    acceptBroadcast(_input: PaneBroadcast) {},
    capture() {
      return renderLines({ ...lastCtx, focused: false }).map(stripAnsi).join('\n');
    },
    get isAlive() { return alive; },
    on: obs.on,
    dispose() {
      alive = false;
      if (debug.enabled) debug.log('acp.shell', 'pane-dispose', { title: spec.title ?? 'ACP Channels' });
      try { stopDrm(); } catch { /* ignore */ }
      try { stopBgState(); } catch { /* ignore */ }
      try { stopBgCreate(); } catch { /* ignore */ }
      try { stopPersistence(); } catch { /* ignore */ }
    },
  };
}

function buildContextMenuItemsForStub(stub: AcpSessionStub): Array<{
  value: AcpContextMenuAction;
  label: string;
  disabled?: boolean;
}> {
  return [
    { value: 'primary', label: resolvePrimaryActionForStub(stub).label },
    { value: 'copy-session-id', label: 'Copy session id' },
    {
      value: 'copy-backend-session-id',
      label: 'Copy backend session id',
      disabled: stub.meta?.['backendSessionId'] === undefined,
    },
    { value: 'copy-summary', label: 'Copy summary' },
    { value: 'copy-excerpt', label: 'Copy excerpt' },
  ];
}

function labelForContextMenuAction(action: AcpContextMenuAction): string {
  switch (action) {
    case 'primary': return 'Run primary action';
    case 'copy-session-id': return 'Copy session id';
    case 'copy-backend-session-id': return 'Copy backend session id';
    case 'copy-summary': return 'Copy summary';
    case 'copy-excerpt': return 'Copy excerpt';
  }
}

function widestContextMenuLabel(
  items: ReadonlyArray<{ label: string }>,
): number {
  let width = 0;
  for (const item of items) width = Math.max(width, cellWidth(item.label));
  return width;
}

function resolveActiveStub(
  activeId: string | undefined,
  deps: AcpChannelBrowserDeps,
  scope: 'all' | 'browser' | 'history' = 'all',
): AcpSessionStub | null {
  if (!activeId) return null;
  return resolveStubById(activeId, deps, scope);
}

function resolveStubById(
  id: string,
  deps: AcpChannelBrowserDeps,
  scope: 'all' | 'browser' | 'history' = 'all',
): AcpSessionStub | null {
  return listAcpChannelStubs(deps, scope).find((stub) => stub.id === id) ?? null;
}

async function runDefaultAcpChannelPrimaryAction(
  action: AcpChannelPrimaryAction,
  stub: AcpSessionStub,
): Promise<string> {
  switch (action.id) {
    case 'promote-background-vw': {
      const result = await dispatchAcpSessionJoin({ backgroundId: stub.id, promoteToVW: true });
      if (result.promoted && result.windowId) return `Promoted to VW ${result.windowId}`;
      return 'Joined background lane';
    }
    case 'join-background-transcript': {
      await dispatchAcpSessionJoin({ backgroundId: stub.id, promoteToVW: false });
      return 'Loaded background transcript';
    }
    case 'resume-persisted-session': {
      await dispatchAcpSessionResume({ sessionId: stub.id });
      return 'Resumed persisted ACP session';
    }
    case 'open-live-client-room':
      return 'Live client room handoff not wired yet';
    case 'open-live-server-room':
      return 'Live server room handoff not wired yet';
    default:
      return 'No ACP action wired for this lane';
  }
}

function listAcpChannelStubs(
  deps: AcpChannelBrowserDeps,
  scope: 'all' | 'browser' | 'history' = 'all',
): AcpSessionStub[] {
  const live = [
    ...deps.dualRoleManager.listAsSidebarStubs(),
    ...deps.backgroundManager.list().map(backgroundToStub),
  ];
  const existing = new Set(live.map((stub) => stub.id));
  const persisted = deps.persistence
    .list()
    .filter((record) => !existing.has(record.sessionId))
    .map(persistedToStub);
  if (scope === 'browser') return live;
  if (scope === 'history') return persisted;
  return [...live, ...persisted];
}

function applyAcpChannelOrder(
  stubs: readonly AcpSessionStub[],
  orderedIds: readonly string[] | undefined,
): AcpSessionStub[] {
  const sorted = [...stubs];
  if (!orderedIds || orderedIds.length === 0) return sorted;
  const order = new Map<string, number>();
  orderedIds.forEach((id, idx) => order.set(id, idx));
  return sorted.sort((a, b) => {
    const aIdx = order.get(a.id);
    const bIdx = order.get(b.id);
    if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
    if (aIdx !== undefined) return -1;
    if (bIdx !== undefined) return 1;
    return 0;
  });
}

function persistedToStub(record: PersistedAcpSession): AcpSessionStub {
  return {
    id: record.sessionId,
    title: `History · ${record.backendId} · ${historyLeaf(record.cwd)}`,
    agentKind: 'background',
    isAlive: false,
    createdAt: record.createdAt,
    lastActivityAt: record.lastSeenAt,
    meta: {
      namespace: 'acp-hist',
      backendId: record.backendId,
      backendSessionId: record.backendSessionId,
      origin: record.origin,
      protocolVersion: record.protocolVersion,
      persisted: true,
    },
  };
}

function historyLeaf(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : cwd || 'session';
}

function createObserver(): {
  emit: () => void;
  on: (event: 'update' | 'output' | 'exit', cb: () => void) => PaneUnsubscribe;
} {
  const subs = new Map<'update' | 'output' | 'exit', Set<() => void>>();
  return {
    emit() {
      for (const cb of subs.get('update') ?? []) {
        try { cb(); } catch { /* ignore */ }
      }
    },
    on(event, cb) {
      const set = subs.get(event) ?? new Set<() => void>();
      set.add(cb);
      subs.set(event, set);
      return () => { set.delete(cb); };
    },
  };
}
