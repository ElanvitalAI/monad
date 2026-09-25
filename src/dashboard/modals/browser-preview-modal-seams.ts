import { readFileSync } from 'fs';

import { C } from '../../tui.js';
import { dirColor, fileColor, fileIcon, sizeStr } from '../../panes/file-icons.js';
import { canPreview } from '../../panes/preview-pane.js';
import { colorLine } from '../../panes/syntax-color.js';
import type {
  LivePaneMultiModalColumn,
  LivePaneMultiModalHandle,
  PaneMultiModalColumn,
  PaneMultiModalChromeAction,
  PaneMultiModalHandle,
  PaneMultiModalChromeSpec,
  ShowLivePaneMultiModalParams,
  ShowPaneMultiModalParams,
} from './pane-multi.js';
import {
  resolvePaneMultiLiveSnapshotChrome,
} from './pane-multi-chrome.js';
import { showLivePaneMultiModal, showPaneMultiModal } from './pane-multi.js';
import type { ThemeTokens } from '../../theme/tokens.js';
import type { WidgetHost } from '../../widgets/host.js';
import type { DisplayCoordinator } from '../../display/coordinator.js';
import type { DisplayMouseEvent } from '../../display/types.js';
import { encodeBrowserScopedSubmitText } from '../../browser-pane/actions.js';
import type { BrowserPaneRegistry } from '../../browser-pane/registry.js';
import type { PreviewPaneModel } from '../../preview-pane/model.js';
import type { PreviewPaneRegistry } from '../../preview-pane/registry.js';
import { browserNavInto, browserNavParent } from '../../working-dir/browser-nav.js';
import {
  readDirEntries,
  sortEntries,
  type BrowserPaneModel,
  type FsEntry,
} from '../../working-dir/index.js';

const FOLDER_ICON = '';

export interface BrowserPreviewModalBrowserWidgetState {
  items: string[];
  icons: string[];
  cursor: number;
  offset: number;
  preserveAnsi: boolean;
  submitText: string[];
  selected: Set<string>;
}

export interface BrowserPreviewModalPreviewWidgetState {
  text: string;
  scroll: number;
  focused: boolean;
  preformatted: boolean;
}

export interface BrowserPreviewModalPreviewProjection {
  state: BrowserPreviewModalPreviewWidgetState;
  character: string;
}

export interface BrowserPreviewModalCursorSyncResult {
  prevCursor: number;
  nextCursor: number;
  entryCount: number;
}

export interface BrowserPreviewModalNavigationResult {
  changed: boolean;
  direction: 'left' | 'right';
  cwd: string;
}

export interface BrowserPreviewModalProjectionDeps {
  browserWidgetInstanceId: string;
  fmtEntryColored(entry: FsEntry): string;
  iconForEntry(entry: FsEntry): string;
}

export interface BrowserPreviewModalWidgetIds {
  browserWidgetInstanceId: string;
  modalBrowserWidgetInstanceId: string;
  modalPreviewWidgetInstanceId: string;
}

export interface BrowserPreviewModalWidgetLike {
  type: string;
  character?: string;
  config?: unknown;
}

export interface BrowserPreviewModalSessionHandle {
  dispose(): void;
}

export interface BrowserPreviewModalRuntimeHost {
  getHandle(): BrowserPreviewModalSessionHandle | null;
  setHandle(handle: BrowserPreviewModalSessionHandle | null): void;
  getPopupDispose(): (() => void) | null;
  setPopupDispose(dispose: (() => void) | null): void;
  closeHandleAndDraw(): void;
}

export interface BrowserPreviewModalSessionDeps {
  widgetHost: Pick<WidgetHost, 'dispose' | 'disposeById'>;
  modalWidgetIds: Pick<BrowserPreviewModalWidgetIds, 'modalBrowserWidgetInstanceId' | 'modalPreviewWidgetInstanceId'>;
  clearContextMenuCursorResolver(): void;
  clearCloseRequest(): void;
  getPopupDispose(): (() => void) | null;
  setPopupDispose(dispose: (() => void) | null): void;
  deleteModalWorkingDir(): void;
  deleteModalPreview(): void;
  resolveNextFocus(): { nextFocus: string; currentFocus: string };
  applyNextFocus(nextFocus: string): void;
  onDraw(): void;
  onSubmit(text: string): void;
  onOpenModelPicker(action: PaneMultiModalChromeAction): void;
  getHandle(): BrowserPreviewModalSessionHandle | null;
  debug?: {
    enabled: boolean;
    log(scope: string, message: string, meta?: Record<string, unknown>): void;
  };
  debugMeta?: {
    preFocus: string;
    tabletMode: boolean;
  };
}

export interface BrowserPreviewModalLiveColumnsDeps {
  browserWidgetInstanceId: string;
  modalBrowserWidgetInstanceId: string;
  modalPreviewWidgetInstanceId: string;
  hasBrowserWidget: boolean;
  hasPreviewWidget: boolean;
  modalWorkingDir: Pick<BrowserPaneModel, 'entries'>;
  navigate(direction: 'left' | 'right'): BrowserPreviewModalNavigationResult;
  syncBrowserWidgetFromState(): void;
  syncPreviewFromCursor(cursor: number): void;
  afterBrowserInteraction(): void;
  onSubmit(text: string): void;
  onDraw(): void;
  onRightClick(ev: unknown, meta: { localRow: number; localCol: number; cellIndex: number }): { type: 'refresh' | 'none' };
  debug?: {
    enabled: boolean;
    log(scope: string, message: string, meta?: Record<string, unknown>): void;
  };
}

export interface BrowserPreviewModalOpenBindingsDeps {
  onDraw(): void;
  getHandle(): BrowserPreviewModalSessionHandle | null;
  onChromeAction(action: PaneMultiModalChromeAction): void;
}

export interface OpenBrowserPreviewModalSurfaceDeps {
  liveMode: boolean;
  title: string;
  layoutMode: '2x1';
  chrome: PaneMultiModalChromeSpec;
  group: string;
  coordinator: DisplayCoordinator;
  termCols: number;
  termRows: number;
  onDispose(): void;
  onCancel(): void;
  onChromeAction(action: PaneMultiModalChromeAction): void;
  widgetHost: Pick<WidgetHost, 'get' | 'defFor'>;
  liveColumns: LivePaneMultiModalColumn[];
  snapshotColumns: PaneMultiModalColumn[];
}

export interface BrowserPreviewModalRuntimeHostDeps {
  onDraw(): void;
}

export interface OpenBrowserPreviewModalHostDeps {
  termCols: number;
  termRows: number;
  preFocus: string;
  preModalPaneFocus: string;
  tabletMode: boolean;
  browserWidgetInstanceId: string;
  liveMode: boolean;
  workingDirFocus: string;
  widgetHost: Pick<WidgetHost, 'get' | 'spawn' | 'dispose' | 'disposeById' | 'defFor'>;
  workingDirRegistry: Pick<BrowserPaneRegistry, 'cloneInto' | 'delete'>;
  previewRegistry: Pick<PreviewPaneRegistry, 'ensure' | 'delete'>;
  display: DisplayCoordinator;
  draw(): void;
  debug?: {
    enabled: boolean;
    log(scope: string, message: string, meta?: Record<string, unknown>): void;
  };
  currentThemeTokens(): ThemeTokens;
  dispatchSubmit(text: string): void;
  setWorkingFocus(nextFocus: string): void;
  setContextMenuCursorResolver(
    resolver: ((...args: never[]) => number | null) | null,
  ): void;
  setCloseRequest(handler: (() => void) | null): void;
  openModelPicker(action: PaneMultiModalChromeAction): Promise<(() => void) | null> | (() => void) | null;
  captureDeferredPane(pane: 'browser' | 'preview'): string;
  fmtEntryColored(entry: FsEntry): string;
  iconForEntry(entry: FsEntry): string;
  onContextMenuMouse(ev: DisplayMouseEvent): boolean;
}

export function projectBrowserPreviewModalBrowserState(
  modalWorkingDir: BrowserPaneModel,
  deps: BrowserPreviewModalProjectionDeps,
): BrowserPreviewModalBrowserWidgetState {
  const entries = modalWorkingDir.entries;
  const selected = new Set<string>();
  for (const entry of entries) {
    if (modalWorkingDir.selected.has(entry.absPath)) {
      selected.add(deps.fmtEntryColored(entry));
    }
  }
  return {
    items: entries.map(deps.fmtEntryColored),
    icons: entries.map(deps.iconForEntry),
    cursor: modalWorkingDir.cursor,
    offset: modalWorkingDir.offset,
    preserveAnsi: true,
    submitText: entries.map((entry) => {
      if (entry.name === '..') {
        return encodeBrowserScopedSubmitText('wd-cd', deps.browserWidgetInstanceId, entry.absPath);
      }
      return entry.isDir
        ? encodeBrowserScopedSubmitText('folder-attach', deps.browserWidgetInstanceId, entry.absPath)
        : encodeBrowserScopedSubmitText('file-attach', deps.browserWidgetInstanceId, entry.absPath);
    }),
    selected,
  };
}

export function createBrowserPreviewModalWidgetIds(
  browserWidgetInstanceId: string,
): BrowserPreviewModalWidgetIds {
  return {
    browserWidgetInstanceId,
    modalBrowserWidgetInstanceId: `${browserWidgetInstanceId}::pane-multi-modal`,
    modalPreviewWidgetInstanceId: 'wd-preview::pane-multi-modal',
  };
}

export function resolveBrowserPreviewModalLiveMode(
  envValue: string | undefined,
): boolean {
  return (envValue ?? 'on').toLowerCase() !== 'off';
}

export function createBrowserPreviewModalRuntimeHost(
  deps: BrowserPreviewModalRuntimeHostDeps,
): BrowserPreviewModalRuntimeHost {
  let handle: BrowserPreviewModalSessionHandle | null = null;
  let popupDispose: (() => void) | null = null;
  return {
    getHandle: () => handle,
    setHandle: (nextHandle) => { handle = nextHandle; },
    getPopupDispose: () => popupDispose,
    setPopupDispose: (dispose) => { popupDispose = dispose; },
    closeHandleAndDraw(): void {
      handle?.dispose();
      deps.onDraw();
    },
  };
}

export function projectBrowserPreviewModalPreview(
  modalWorkingDir: BrowserPaneModel,
  cursor: number,
): BrowserPreviewModalPreviewProjection {
  const entry = modalWorkingDir.entries[cursor] ?? null;
  if (!entry || entry.name === '..') {
    return {
      character: 'Preview',
      state: {
        text: '',
        scroll: 0,
        focused: false,
        preformatted: true,
      },
    };
  }

  const lines: string[] = [];
  const ext = entry.ext ? `.${entry.ext}` : '';
  if (entry.isDir) {
    lines.push(`${C.accent(FOLDER_ICON)} ${dirColor(entry.name)}`);
    lines.push(C.muted(entry.absPath));
    lines.push('');
    try {
      const { folders, files } = readDirEntries(entry.absPath, modalWorkingDir.showHidden);
      const sortedDirs = sortEntries(folders, modalWorkingDir.sortMode);
      const sortedFiles = sortEntries(files, modalWorkingDir.sortMode);
      for (const folder of sortedDirs) lines.push(`  ${C.accent(FOLDER_ICON)} ${dirColor(folder.name)}`);
      for (const file of sortedFiles) {
        const icon = fileColor(file.name)(fileIcon(file.name));
        const name = fileColor(file.name)(file.name);
        lines.push(`  ${icon} ${name}  ${C.muted(sizeStr(file.size))}`);
      }
      if (sortedDirs.length + sortedFiles.length === 0) lines.push(C.muted('  (empty)'));
    } catch {
      lines.push(C.muted('  (unreadable)'));
    }
    return {
      character: 'Preview · Directory',
      state: {
        text: lines.join('\n'),
        scroll: 0,
        focused: false,
        preformatted: true,
      },
    };
  }

  lines.push(`${fileColor(entry.name)(fileIcon(entry.name))} ${fileColor(entry.name)(entry.name)}`);
  lines.push(C.muted(entry.absPath));
  lines.push('');
  if (!canPreview(entry.absPath)) {
    lines.push(C.muted('  (binary or non-text — no preview)'));
  } else {
    try {
      const raw = readFileSync(entry.absPath, 'utf-8');
      const allLines = raw.split('\n');
      const bodyLines = allLines.slice(0, 1000);
      for (let i = 0; i < bodyLines.length; i++) {
        const gutter = C.muted(String(i + 1).padStart(4) + ' │ ');
        lines.push(`${gutter}${colorLine(bodyLines[i]!, ext)}`);
      }
      if (allLines.length > bodyLines.length) {
        lines.push(C.muted(`  ... +${allLines.length - bodyLines.length} more lines`));
      }
    } catch {
      lines.push(C.muted('  (unable to read)'));
    }
  }
  return {
    character: 'Preview',
    state: {
      text: lines.join('\n'),
      scroll: 0,
      focused: false,
      preformatted: true,
    },
  };
}

export function applyBrowserPreviewModalPreviewProjection(
  previewModel: PreviewPaneModel,
  projection: BrowserPreviewModalPreviewProjection,
  entry: FsEntry | null,
): void {
  previewModel.previewPath = entry && entry.name !== '..' ? entry.absPath : null;
  previewModel.previewLines = projection.state.text.length > 0
    ? projection.state.text.split('\n')
    : [];
  previewModel.previewOffset = projection.state.scroll;
}

export function syncBrowserPreviewModalCursorFromWidgetState(
  modalWorkingDir: BrowserPaneModel,
  browserState: { cursor?: number; offset?: number } | null | undefined,
): BrowserPreviewModalCursorSyncResult | null {
  if (typeof browserState?.cursor !== 'number') return null;
  const entryCount = modalWorkingDir.entries.length;
  const nextCursor = Math.max(0, Math.min(browserState.cursor, Math.max(0, entryCount - 1)));
  const prevCursor = modalWorkingDir.cursor;
  modalWorkingDir.cursor = nextCursor;
  if (typeof browserState.offset === 'number') {
    modalWorkingDir.offset = browserState.offset;
  }
  return { prevCursor, nextCursor, entryCount };
}

export function navigateBrowserPreviewModalDirectory(
  modalWorkingDir: BrowserPaneModel,
  direction: 'left' | 'right',
): BrowserPreviewModalNavigationResult {
  const changed = direction === 'left'
    ? browserNavParent(modalWorkingDir)
    : browserNavInto(modalWorkingDir);
  if (!changed) {
    return {
      changed: false,
      direction,
      cwd: modalWorkingDir.cwd,
    };
  }
  modalWorkingDir.cursor = 0;
  modalWorkingDir.offset = 0;
  return {
    changed: true,
    direction,
    cwd: modalWorkingDir.cwd,
  };
}

export function createBrowserPreviewModalChrome(
  liveMode: boolean,
  theme: ThemeTokens,
): PaneMultiModalChromeSpec {
  return resolvePaneMultiLiveSnapshotChrome({
    theme,
    titlePrefix: '⠿',
    controlMode: 'model-close',
    subject: 'browser · preview',
    liveMode,
  });
}

export function replaceBrowserPreviewModalWidgetInstances(
  widgetHost: Pick<WidgetHost, 'get' | 'spawn' | 'dispose' | 'disposeById'>,
  ids: BrowserPreviewModalWidgetIds,
): { hasBrowserWidget: boolean; hasPreviewWidget: boolean } {
  const sourceBrowserWidget = widgetHost.get(ids.browserWidgetInstanceId);
  const sourcePreviewWidget = widgetHost.get('wd-preview');

  disposeBrowserPreviewModalWidgetInstances(
    widgetHost,
    ids,
    'browser-preview-modal-replace',
  );

  if (sourceBrowserWidget) {
    widgetHost.spawn({
      id: ids.modalBrowserWidgetInstanceId,
      type: sourceBrowserWidget.type,
      character: sourceBrowserWidget.character,
      config: sourceBrowserWidget.config,
    });
  }
  if (sourcePreviewWidget) {
    widgetHost.spawn({
      id: ids.modalPreviewWidgetInstanceId,
      type: sourcePreviewWidget.type,
      character: sourcePreviewWidget.character,
      config: sourcePreviewWidget.config,
    });
  }

  return {
    hasBrowserWidget: !!sourceBrowserWidget,
    hasPreviewWidget: !!sourcePreviewWidget,
  };
}

export function disposeBrowserPreviewModalWidgetInstances(
  widgetHost: Pick<WidgetHost, 'dispose' | 'disposeById'>,
  ids: Pick<BrowserPreviewModalWidgetIds, 'modalBrowserWidgetInstanceId' | 'modalPreviewWidgetInstanceId'>,
  reason: string,
): void {
  try { widgetHost.disposeById(ids.modalBrowserWidgetInstanceId, reason); }
  catch {
    try { widgetHost.dispose(ids.modalBrowserWidgetInstanceId); } catch { /* ignore */ }
  }
  try { widgetHost.disposeById(ids.modalPreviewWidgetInstanceId, reason); }
  catch {
    try { widgetHost.dispose(ids.modalPreviewWidgetInstanceId); } catch { /* ignore */ }
  }
}

export function handleBrowserPreviewModalChromeAction(
  action: PaneMultiModalChromeAction,
  callbacks: {
    onModel(): void;
    onClose(): void;
  },
): boolean {
  if (action.controlId === 'model') {
    callbacks.onModel();
    return true;
  }
  if (action.controlId === 'close') {
    callbacks.onClose();
    return true;
  }
  return false;
}

export function createBrowserPreviewModalSession(
  deps: BrowserPreviewModalSessionDeps,
): {
  onDispose(): void;
  requestClose(): void;
  handleSubmit(text: string): void;
  handleChromeAction(action: PaneMultiModalChromeAction): void;
} {
  const closeHandle = (): void => {
    deps.getHandle()?.dispose();
    deps.onDraw();
  };

  return {
    onDispose(): void {
      deps.clearContextMenuCursorResolver();
      deps.clearCloseRequest();
      const popupDispose = deps.getPopupDispose();
      if (popupDispose) {
        try { popupDispose(); } catch { /* ignore */ }
        deps.setPopupDispose(null);
      }
      disposeBrowserPreviewModalWidgetInstances(
        deps.widgetHost,
        deps.modalWidgetIds,
        'browser-preview-modal-close',
      );
      deps.deleteModalWorkingDir();
      deps.deleteModalPreview();
      const { nextFocus, currentFocus } = deps.resolveNextFocus();
      if (nextFocus !== currentFocus) {
        deps.applyNextFocus(nextFocus);
      }
      if (deps.debug?.enabled) {
        deps.debug.log('tablet.pane-multi.dispose', 'Ctrl+M B', {
          preFocus: deps.debugMeta?.preFocus,
          nextFocus,
          tabletMode: deps.debugMeta?.tabletMode,
        });
      }
    },
    requestClose(): void {
      closeHandle();
    },
    handleSubmit(text: string): void {
      deps.getHandle()?.dispose();
      deps.onDraw();
      deps.onSubmit(text);
    },
    handleChromeAction(action: PaneMultiModalChromeAction): void {
      handleBrowserPreviewModalChromeAction(action, {
        onModel: () => deps.onOpenModelPicker(action),
        onClose: () => closeHandle(),
      });
    },
  };
}

export function createBrowserPreviewModalLiveColumns(
  deps: BrowserPreviewModalLiveColumnsDeps,
): LivePaneMultiModalColumn[] {
  return [
    {
      title: 'browser',
      widgetInstanceId: deps.hasBrowserWidget
        ? deps.modalBrowserWidgetInstanceId
        : deps.browserWidgetInstanceId,
      weight: 2,
      onIntercept: (ev) => {
        if (ev.name === 'left' || ev.name === 'right') {
          const navResult = deps.navigate(ev.name);
          if (navResult.changed) {
            deps.syncBrowserWidgetFromState();
            deps.syncPreviewFromCursor(0);
            if (deps.debug?.enabled) {
              deps.debug.log('tablet.pane-multi.browser.nav', navResult.direction === 'left' ? 'parent' : 'into', {
                cwd: navResult.cwd,
              });
            }
            deps.onDraw();
          }
          return 'consumed';
        }
        return undefined;
      },
      onAfterKey: (action) => {
        deps.afterBrowserInteraction();
        if (action.type === 'submit') deps.onSubmit(action.text);
      },
      onAfterMouse: (action) => {
        deps.afterBrowserInteraction();
        if (action.type === 'submit') deps.onSubmit(action.text);
      },
      onRightClick: (ev, meta) => deps.onRightClick(ev, meta),
    },
    {
      title: 'preview',
      widgetInstanceId: deps.hasPreviewWidget
        ? deps.modalPreviewWidgetInstanceId
        : 'wd-preview',
      weight: 3,
    },
  ];
}

export function createBrowserPreviewModalSnapshotColumns(
  captureDeferredPane: (pane: 'browser' | 'preview') => string,
): PaneMultiModalColumn[] {
  return [
    { title: 'browser', lines: captureDeferredPane('browser').split('\n'), weight: 2 },
    { title: 'preview', lines: captureDeferredPane('preview').split('\n'), weight: 3 },
  ];
}

export function createBrowserPreviewModalOpenBindings(
  deps: BrowserPreviewModalOpenBindingsDeps,
): {
  onCancel(): void;
  onChromeAction(action: PaneMultiModalChromeAction): void;
} {
  return {
    onCancel(): void {
      deps.getHandle()?.dispose();
      deps.onDraw();
    },
    onChromeAction(action: PaneMultiModalChromeAction): void {
      deps.onChromeAction(action);
    },
  };
}

export function openBrowserPreviewModalSurface(
  deps: OpenBrowserPreviewModalSurfaceDeps,
): { dispose(): void } {
  if (deps.liveMode) {
    const params: ShowLivePaneMultiModalParams = {
      title: deps.title,
      layoutMode: deps.layoutMode,
      columns: deps.liveColumns,
      widgetHost: deps.widgetHost,
      coordinator: deps.coordinator,
      termCols: deps.termCols,
      termRows: deps.termRows,
      ttlMs: 0,
      group: deps.group,
      onDispose: deps.onDispose,
      onCancel: deps.onCancel,
      chrome: deps.chrome,
      onChromeAction: deps.onChromeAction,
    };
    return showLivePaneMultiModal(params) satisfies LivePaneMultiModalHandle;
  }
  const params: ShowPaneMultiModalParams = {
    title: deps.title,
    layoutMode: deps.layoutMode,
    columns: deps.snapshotColumns,
    coordinator: deps.coordinator,
    termCols: deps.termCols,
    termRows: deps.termRows,
    ttlMs: 0,
    group: deps.group,
    onDispose: deps.onDispose,
    onCancel: deps.onCancel,
    chrome: deps.chrome,
    onChromeAction: deps.onChromeAction,
  };
  return showPaneMultiModal(params) satisfies PaneMultiModalHandle;
}

export function openBrowserPreviewModalHost(
  deps: OpenBrowserPreviewModalHostDeps,
): void {
  const runtime = createBrowserPreviewModalRuntimeHost({
    onDraw: deps.draw,
  });
  const modalWidgetIds = createBrowserPreviewModalWidgetIds(deps.browserWidgetInstanceId);
  const { modalBrowserWidgetInstanceId, modalPreviewWidgetInstanceId } = modalWidgetIds;
  const modalWorkingDir = deps.workingDirRegistry.cloneInto(
    deps.browserWidgetInstanceId,
    modalBrowserWidgetInstanceId,
  );
  const modalPreview = deps.previewRegistry.ensure(
    modalPreviewWidgetInstanceId,
    { mode: 'modal' },
  );

  if (deps.debug?.enabled) {
    deps.debug.log('tablet.pane-multi.open', 'Ctrl+M B', {
      panes: ['browser', 'preview'],
      browserWidgetInstanceId: deps.browserWidgetInstanceId,
      termCols: deps.termCols,
      termRows: deps.termRows,
      tabletMode: deps.tabletMode,
      preFocus: deps.preFocus,
      liveMode: deps.liveMode,
    });
  }

  const session = createBrowserPreviewModalSession({
    widgetHost: deps.widgetHost,
    modalWidgetIds,
    clearContextMenuCursorResolver: () => { deps.setContextMenuCursorResolver(null); },
    clearCloseRequest: () => { deps.setCloseRequest(null); },
    getPopupDispose: runtime.getPopupDispose,
    setPopupDispose: runtime.setPopupDispose,
    deleteModalWorkingDir: () => { deps.workingDirRegistry.delete(modalBrowserWidgetInstanceId); },
    deleteModalPreview: () => { deps.previewRegistry.delete(modalPreviewWidgetInstanceId); },
    resolveNextFocus: () => ({
      nextFocus: deps.tabletMode ? 'log' : deps.preModalPaneFocus,
      currentFocus: deps.workingDirFocus,
    }),
    applyNextFocus: (nextFocus) => { deps.setWorkingFocus(nextFocus); },
    onDraw: deps.draw,
    onSubmit: deps.dispatchSubmit,
    onOpenModelPicker: (action) => {
      void (async () => {
        if (runtime.getPopupDispose()) {
          try { runtime.getPopupDispose()?.(); } catch { /* ignore */ }
          runtime.setPopupDispose(null);
        }
        const dispose = await deps.openModelPicker(action);
        runtime.setPopupDispose(dispose ?? null);
        deps.draw();
      })();
    },
    getHandle: runtime.getHandle,
    debug: deps.debug,
    debugMeta: {
      preFocus: deps.preFocus,
      tabletMode: deps.tabletMode,
    },
  });

  const syncPreviewFromCursor = (cursor: number): void => {
    const preview = deps.widgetHost.get(modalPreviewWidgetInstanceId) as {
      state?: {
        text?: string;
        scroll?: number;
        focused?: boolean;
        preformatted?: boolean;
      };
      character?: string;
    } | null;
    if (!preview?.state) return;
    const projection = projectBrowserPreviewModalPreview(modalWorkingDir, cursor);
    applyBrowserPreviewModalPreviewProjection(
      modalPreview,
      projection,
      modalWorkingDir.entries[cursor] ?? null,
    );
    preview.state.text = projection.state.text;
    preview.state.scroll = projection.state.scroll;
    preview.state.focused = projection.state.focused;
    preview.state.preformatted = projection.state.preformatted;
    preview.character = projection.character;
    if (deps.debug?.enabled) {
      const entry = modalWorkingDir.entries[cursor] ?? null;
      const kind = !entry || entry.name === '..'
        ? 'empty'
        : entry.isDir
          ? 'directory'
          : 'file';
      deps.debug.log('tablet.pane-multi.preview-sync', kind, {
        kind,
        cursor,
        widgetId: modalPreviewWidgetInstanceId,
        entry: entry ? { name: entry.name, absPath: entry.absPath, isDir: entry.isDir } : null,
        textLength: projection.state.text.length,
        lineCount: projection.state.text.length > 0 ? projection.state.text.split('\n').length : 0,
      });
    }
  };

  const afterBrowserInteraction = (): void => {
    const inst = deps.widgetHost.get(modalBrowserWidgetInstanceId) as {
      state?: { cursor?: number; offset?: number };
    } | null;
    const syncResult = syncBrowserPreviewModalCursorFromWidgetState(modalWorkingDir, inst?.state);
    if (!syncResult) return;
    syncPreviewFromCursor(syncResult.nextCursor);
    if (deps.debug?.enabled) {
      deps.debug.log('tablet.pane-multi.browser-preview-sync', 'cursor-move', {
        prev: syncResult.prevCursor,
        next: syncResult.nextCursor,
        entryCount: syncResult.entryCount,
        localOnly: true,
      });
    }
  };

  const resolveModalBrowserCursor = (): number | null => {
    const inst = deps.widgetHost.get(modalBrowserWidgetInstanceId) as {
      state?: { cursor?: number };
    } | null;
    return typeof inst?.state?.cursor === 'number' ? inst.state.cursor : null;
  };
  deps.setContextMenuCursorResolver(resolveModalBrowserCursor as (...args: never[]) => number | null);

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
    const projection = projectBrowserPreviewModalBrowserState(modalWorkingDir, {
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

  deps.setCloseRequest(() => {
    session.requestClose();
  });

  const chrome = createBrowserPreviewModalChrome(
    deps.liveMode,
    deps.currentThemeTokens(),
  );
  const openBindings = createBrowserPreviewModalOpenBindings({
    onDraw: deps.draw,
    getHandle: runtime.getHandle,
    onChromeAction: (action) => {
      session.handleChromeAction(action);
    },
  });
  const liveWidgetAvailability = deps.liveMode
    ? replaceBrowserPreviewModalWidgetInstances(deps.widgetHost, modalWidgetIds)
    : { hasBrowserWidget: false, hasPreviewWidget: false };
  if (deps.liveMode && liveWidgetAvailability.hasBrowserWidget) {
    syncBrowserWidgetFromState();
  }
  if (deps.liveMode && liveWidgetAvailability.hasPreviewWidget) {
    syncPreviewFromCursor(modalWorkingDir.cursor);
  }

  runtime.setHandle(openBrowserPreviewModalSurface({
    liveMode: deps.liveMode,
    title: 'Browser + Preview',
    layoutMode: '2x1',
    chrome,
    group: 'pane-multi-modal',
    coordinator: deps.display,
    termCols: deps.termCols,
    termRows: deps.termRows,
    onDispose: session.onDispose,
    onCancel: openBindings.onCancel,
    onChromeAction: openBindings.onChromeAction,
    widgetHost: deps.widgetHost,
    liveColumns: createBrowserPreviewModalLiveColumns({
      browserWidgetInstanceId: deps.browserWidgetInstanceId,
      modalBrowserWidgetInstanceId,
      modalPreviewWidgetInstanceId,
      hasBrowserWidget: liveWidgetAvailability.hasBrowserWidget,
      hasPreviewWidget: liveWidgetAvailability.hasPreviewWidget,
      modalWorkingDir,
      navigate: (direction) => navigateBrowserPreviewModalDirectory(modalWorkingDir, direction),
      syncBrowserWidgetFromState,
      syncPreviewFromCursor,
      afterBrowserInteraction,
      onSubmit: (text) => { session.handleSubmit(text); },
      onDraw: deps.draw,
      onRightClick: (ev, meta) => {
        const modalBrowserInst = deps.widgetHost.get(modalBrowserWidgetInstanceId) as {
          state?: { items?: string[]; offset?: number };
        } | null;
        const offset = modalBrowserInst?.state?.offset ?? 0;
        const itemIndex = offset + meta.localRow;
        const validItemIndex =
          itemIndex >= 0 && itemIndex < modalWorkingDir.entries.length
            ? itemIndex
            : undefined;
        return (
          deps.onContextMenuMouse({
            ...(ev as DisplayMouseEvent),
            hitTarget: {
              kind: 'pane-body',
              paneId: deps.browserWidgetInstanceId,
              widgetInstanceId: modalBrowserWidgetInstanceId,
              hit: validItemIndex === undefined
                ? undefined
                : { kind: 'list-row', itemIndex: validItemIndex },
            },
          })
          ? { type: 'refresh' as const }
          : { type: 'none' as const }
        );
      },
      debug: deps.debug,
    }),
    snapshotColumns: createBrowserPreviewModalSnapshotColumns((pane) => deps.captureDeferredPane(pane)),
  }));
}
