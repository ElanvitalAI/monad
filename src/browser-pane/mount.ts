import { dirname } from 'path';

import type { DisplayCoordinator } from '../display/coordinator.js';
import { PaneContent, type PaneBroadcast, type PaneUnsubscribe } from '../virtual-windows/pane-content.js';
import { mintPaneId } from '../virtual-windows/addressing.js';
import type { Action, DisplayMouseEvent, KeyEvent } from '../display/types.js';
import {
  showLivePaneMultiModal,
  showPaneMultiModal,
  type LivePaneMultiModalHandle,
  type PaneMultiModalChromeAction,
  type PaneMultiModalChromeSpec,
  type PaneMultiModalHandle,
  type ShowLivePaneMultiModalParams,
  type ShowPaneMultiModalParams,
} from '../dashboard/modals/pane-multi.js';
import {
  resolvePaneMultiLiveSnapshotChrome,
} from '../dashboard/modals/pane-multi-chrome.js';
import type { ThemeTokens } from '../theme/tokens.js';
import type { WidgetHost } from '../widgets/host.js';
import type { BrowserPaneRegistry } from './registry.js';
import {
  focusedBrowserEntry,
  refreshBrowserPane,
  toggleBrowserSelection,
  type FsEntry,
  type BrowserPaneModel,
} from './model.js';
import { C, pad, truncate, visibleWidth } from '../tui.js';
import { dirColor, fileColor, fileIcon, sizeStr } from '../panes/file-icons.js';
import {
  navigateBrowserPreviewModalDirectory,
  projectBrowserPreviewModalBrowserState,
  syncBrowserPreviewModalCursorFromWidgetState,
} from '../dashboard/modals/browser-preview-modal-seams.js';

export interface BrowserPaneContentSpec {
  kind: 'vw-browser';
  browserId: string;
  title?: string;
}

export interface BrowserPaneMountDeps {
  browserPaneRegistry: BrowserPaneRegistry;
  refreshRemoteBrowserPane?: (state: BrowserPaneModel) => Promise<void>;
}

export interface OpenBrowserPaneModalDeps {
  browserWidgetInstanceId: string;
  liveMode: boolean;
  browserPaneRegistry: Pick<BrowserPaneRegistry, 'cloneInto' | 'delete'>;
  widgetHost: Pick<WidgetHost, 'get' | 'spawn' | 'dispose' | 'disposeById' | 'defFor'>;
  coordinator: DisplayCoordinator;
  termCols: number;
  termRows: number;
  captureSnapshot(): string;
  theme: ThemeTokens;
  fmtEntryColored(entry: FsEntry): string;
  iconForEntry(entry: FsEntry): string;
  onSubmit?(text: string): void;
  onDispose?(): void;
  onCancel?(): void;
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

function clampBrowserOffset(state: BrowserPaneModel, rows: number): void {
  const bodyRows = Math.max(1, rows);
  if (state.cursor < state.offset) {
    state.offset = state.cursor;
    return;
  }
  if (state.cursor >= state.offset + bodyRows) {
    state.offset = Math.max(0, state.cursor - bodyRows + 1);
  }
}

function formatBrowserLine(
  state: BrowserPaneModel,
  entry: BrowserPaneModel['entries'][number],
  focused: boolean,
  width: number,
): string {
  const cursor = focused ? C.bold('›') : ' ';
  const selected = !entry.isDir && state.selected.has(entry.absPath) ? C.success('●') : ' ';
  if (entry.name === '..') {
    const raw = `${cursor} ${selected} ${C.muted('↩')} ${C.muted('..')}`;
    return visibleWidth(raw) > width ? truncate(raw, width) : pad(raw, width);
  }
  if (entry.isDir) {
    const raw = `${cursor} ${selected} ${C.accent('')} ${dirColor(entry.name)}`;
    return visibleWidth(raw) > width ? truncate(raw, width) : pad(raw, width);
  }
  const icon = fileColor(entry.name)(fileIcon(entry.name));
  const name = fileColor(entry.name)(entry.name);
  const size = C.muted(sizeStr(entry.size));
  const raw = `${cursor} ${selected} ${icon} ${name} ${size}`;
  return visibleWidth(raw) > width ? truncate(raw, width) : pad(raw, width);
}

async function refreshBrowserContentState(
  state: BrowserPaneModel,
  deps: BrowserPaneMountDeps,
): Promise<void> {
  if (!state.remote) {
    refreshBrowserPane(state);
    return;
  }
  await deps.refreshRemoteBrowserPane?.(state);
}

async function navigateBrowserContent(
  state: BrowserPaneModel,
  deps: BrowserPaneMountDeps,
  direction: 'parent' | 'into',
): Promise<boolean> {
  if (!state.remote) {
    if (direction === 'parent') {
      const parent = dirname(state.cwd);
      if (parent === state.cwd) return false;
      state.cwd = parent;
    } else {
      const entry = focusedBrowserEntry(state);
      if (!entry || !entry.isDir || entry.name === '..') return false;
      state.cwd = entry.absPath;
    }
    state.cursor = 0;
    state.offset = 0;
    state.selected.clear();
    refreshBrowserPane(state);
    return true;
  }

  const nextCwd = direction === 'parent'
    ? dirname(state.remote.cwd)
    : (() => {
        const entry = focusedBrowserEntry(state);
        if (!entry || !entry.isDir || entry.name === '..') return null;
        return entry.absPath;
      })();
  if (!nextCwd || nextCwd === state.remote.cwd) return false;
  state.remote = { host: state.remote.host, cwd: nextCwd };
  state.cwd = nextCwd;
  state.cursor = 0;
  state.offset = 0;
  state.selected.clear();
  await refreshBrowserContentState(state, deps);
  return true;
}

export function createBrowserPaneModalChrome(
  theme: ThemeTokens,
  liveMode: boolean,
): PaneMultiModalChromeSpec {
  return resolvePaneMultiLiveSnapshotChrome({
    theme,
    titlePrefix: '⠿',
    controlMode: 'close-only',
    subject: 'browser',
    liveMode,
  });
}

function disposeBrowserPaneModalWidgetInstance(
  widgetHost: Pick<WidgetHost, 'dispose' | 'disposeById'>,
  modalWidgetInstanceId: string,
  reason: string,
): void {
  try { widgetHost.disposeById(modalWidgetInstanceId, reason); }
  catch {
    try { widgetHost.dispose(modalWidgetInstanceId); } catch { /* ignore */ }
  }
}

function replaceBrowserPaneModalWidgetInstance(
  widgetHost: Pick<WidgetHost, 'get' | 'spawn' | 'dispose' | 'disposeById'>,
  sourceWidgetInstanceId: string,
  modalWidgetInstanceId: string,
): boolean {
  disposeBrowserPaneModalWidgetInstance(widgetHost, modalWidgetInstanceId, 'browser-pane-modal-replace');
  const sourceWidget = widgetHost.get(sourceWidgetInstanceId);
  if (!sourceWidget) return false;
  widgetHost.spawn({
    id: modalWidgetInstanceId,
    type: sourceWidget.type,
    character: sourceWidget.character,
    config: sourceWidget.config,
  });
  return true;
}

function resolveBrowserPaneModalChromeAction(
  action: PaneMultiModalChromeAction,
  callbacks: { onClose(): void },
): boolean {
  if (action.controlId !== 'close') return false;
  callbacks.onClose();
  return true;
}

export function openBrowserPaneModal(
  deps: OpenBrowserPaneModalDeps,
): { dispose(): void; id: string; bounds: { row: number; col: number; width: number; height: number } } {
  const modalBrowserWidgetInstanceId = `${deps.browserWidgetInstanceId}::browser-pane-modal`;
  const modalBrowser = deps.browserPaneRegistry.cloneInto(
    deps.browserWidgetInstanceId,
    modalBrowserWidgetInstanceId,
  );
  const chrome = createBrowserPaneModalChrome(deps.theme, deps.liveMode);
  let handle: LivePaneMultiModalHandle | PaneMultiModalHandle | null = null;

  const syncBrowserWidgetFromState = (): void => {
    const inst = deps.widgetHost.get(modalBrowserWidgetInstanceId) as {
      state?: {
        items?: string[];
        icons?: string[];
        cursor?: number;
        offset?: number;
        preserveAnsi?: boolean;
        submitText?: string[];
        selected?: Set<string>;
      };
    } | null;
    if (!inst?.state) return;
    const projection = projectBrowserPreviewModalBrowserState(modalBrowser, {
      browserWidgetInstanceId: deps.browserWidgetInstanceId,
      fmtEntryColored: deps.fmtEntryColored,
      iconForEntry: deps.iconForEntry,
    });
    inst.state.items = projection.items;
    inst.state.icons = projection.icons;
    inst.state.cursor = projection.cursor;
    inst.state.offset = projection.offset;
    inst.state.preserveAnsi = projection.preserveAnsi;
    inst.state.submitText = projection.submitText;
    inst.state.selected = projection.selected;
  };

  const dispose = (): void => {
    if (handle) {
      const current = handle;
      handle = null;
      current.dispose();
      return;
    }
    disposeBrowserPaneModalWidgetInstance(
      deps.widgetHost,
      modalBrowserWidgetInstanceId,
      'browser-pane-modal-close',
    );
    deps.browserPaneRegistry.delete(modalBrowserWidgetInstanceId);
    deps.onDispose?.();
  };

  const onSubmit = (text: string): void => {
    dispose();
    deps.onSubmit?.(text);
  };

  if (deps.liveMode) {
    const hasWidget = replaceBrowserPaneModalWidgetInstance(
      deps.widgetHost,
      deps.browserWidgetInstanceId,
      modalBrowserWidgetInstanceId,
    );
    if (hasWidget) {
      syncBrowserWidgetFromState();
    }
    const params: ShowLivePaneMultiModalParams = {
      title: 'Browser',
      columns: [{
        title: 'browser',
        widgetInstanceId: hasWidget ? modalBrowserWidgetInstanceId : deps.browserWidgetInstanceId,
        weight: 1,
        onIntercept: (ev) => {
          if (ev.name !== 'left' && ev.name !== 'right') return undefined;
          const navResult = navigateBrowserPreviewModalDirectory(modalBrowser, ev.name);
          if (navResult.changed) {
            syncBrowserWidgetFromState();
          }
          return 'consumed';
        },
        onAfterKey: (action) => {
          const inst = deps.widgetHost.get(modalBrowserWidgetInstanceId) as {
            state?: { cursor?: number; offset?: number };
          } | null;
          syncBrowserPreviewModalCursorFromWidgetState(modalBrowser, inst?.state);
          if (action.type === 'submit') onSubmit(action.text);
        },
        onAfterMouse: (action) => {
          const inst = deps.widgetHost.get(modalBrowserWidgetInstanceId) as {
            state?: { cursor?: number; offset?: number };
          } | null;
          syncBrowserPreviewModalCursorFromWidgetState(modalBrowser, inst?.state);
          if (action.type === 'submit') onSubmit(action.text);
        },
      }],
      widgetHost: deps.widgetHost,
      coordinator: deps.coordinator,
      termCols: deps.termCols,
      termRows: deps.termRows,
      ttlMs: 0,
      group: 'browser-pane-modal',
      chrome,
      onDispose: () => {
        disposeBrowserPaneModalWidgetInstance(
          deps.widgetHost,
          modalBrowserWidgetInstanceId,
          'browser-pane-modal-close',
        );
        deps.browserPaneRegistry.delete(modalBrowserWidgetInstanceId);
        deps.onDispose?.();
      },
      onCancel: deps.onCancel,
      onChromeAction: (action) => {
        resolveBrowserPaneModalChromeAction(action, {
          onClose: () => { handle?.dispose(); },
        });
      },
    };
    handle = showLivePaneMultiModal(params);
    return handle;
  }

  const params: ShowPaneMultiModalParams = {
    title: 'Browser',
    columns: [{
      title: 'browser',
      lines: deps.captureSnapshot().split('\n'),
      weight: 1,
    }],
    coordinator: deps.coordinator,
    termCols: deps.termCols,
    termRows: deps.termRows,
    ttlMs: 0,
    group: 'browser-pane-modal',
    chrome,
    onDispose: () => {
      deps.browserPaneRegistry.delete(modalBrowserWidgetInstanceId);
      deps.onDispose?.();
    },
    onCancel: deps.onCancel,
    onChromeAction: (action) => {
      resolveBrowserPaneModalChromeAction(action, {
        onClose: () => { handle?.dispose(); },
      });
    },
  };
  handle = showPaneMultiModal(params);
  return handle;
}

export function createBrowserPaneContent(
  spec: BrowserPaneContentSpec,
  deps: BrowserPaneMountDeps,
): PaneContent {
  const state = deps.browserPaneRegistry.get(spec.browserId);
  if (!state) {
    throw new Error(`createBrowserPaneContent: unknown browser id "${spec.browserId}"`);
  }
  const obs = createObserver();
  let lastRows = 12;

  return {
    id: mintPaneId(),
    kind: spec.kind,
    title: spec.title ?? 'browser',
    focusPolicy: 'interactive',
    start() {},
    stop() {},
    render(ctx) {
      lastRows = Math.max(1, ctx.rows);
      clampBrowserOffset(state, ctx.rows);
      const bodyRows = Math.max(1, ctx.rows);
      const lines: string[] = [];
      for (let i = 0; i < bodyRows; i++) {
        const entry = state.entries[state.offset + i];
        if (!entry) {
          lines.push(' '.repeat(Math.max(0, ctx.cols)));
          continue;
        }
        lines.push(formatBrowserLine(state, entry, state.offset + i === state.cursor, ctx.cols));
      }
      return lines.join('\n');
    },
    onKey(ev) {
      const rows = lastRows;
      if (ev.name === 'up' || ev.name === 'k') {
        state.cursor = Math.max(0, state.cursor - 1);
        clampBrowserOffset(state, rows);
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.name === 'down' || ev.name === 'j') {
        state.cursor = Math.min(Math.max(0, state.entries.length - 1), state.cursor + 1);
        clampBrowserOffset(state, rows);
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.name === 'pageup') {
        state.cursor = Math.max(0, state.cursor - rows);
        clampBrowserOffset(state, rows);
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.name === 'pagedown') {
        state.cursor = Math.min(Math.max(0, state.entries.length - 1), state.cursor + rows);
        clampBrowserOffset(state, rows);
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.name === 'home' || ev.name === 'g') {
        state.cursor = 0;
        state.offset = 0;
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.name === 'end' || (ev.name === 'G' && ev.shift)) {
        state.cursor = Math.max(0, state.entries.length - 1);
        clampBrowserOffset(state, rows);
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.name === ' ') {
        toggleBrowserSelection(state);
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.name === 'left' || ev.name === 'h') {
        void navigateBrowserContent(state, deps, 'parent').then(() => obs.emit());
        return { type: 'refresh' };
      }
      if (ev.name === 'right' || ev.name === 'l' || ev.name === 'enter') {
        const entry = focusedBrowserEntry(state);
        if (!entry?.isDir) return { type: 'none' };
        void navigateBrowserContent(state, deps, 'into').then(() => obs.emit());
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
    onMouse(ev: DisplayMouseEvent): Action {
      const delta = Math.max(1, Math.floor(lastRows / 3));
      if (ev.type === 'scroll-up') {
        state.cursor = Math.max(0, state.cursor - delta);
        clampBrowserOffset(state, lastRows);
        obs.emit();
        return { type: 'refresh' };
      }
      if (ev.type === 'scroll-down') {
        state.cursor = Math.min(Math.max(0, state.entries.length - 1), state.cursor + delta);
        clampBrowserOffset(state, lastRows);
        obs.emit();
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
    write(_bytes: string) {},
    acceptBroadcast(_input: PaneBroadcast) {},
    capture() {
      return state.entries.map((entry, index) =>
        formatBrowserLine(state, entry, index === state.cursor, 120),
      ).join('\n');
    },
    get isAlive() { return true; },
    on: obs.on,
    dispose() {},
  };
}
