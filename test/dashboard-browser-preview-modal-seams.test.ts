import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  createBrowserPreviewModalRuntimeHost,
  createBrowserPreviewModalWidgetIds,
  createBrowserPreviewModalLiveColumns,
  createBrowserPreviewModalOpenBindings,
  createBrowserPreviewModalSnapshotColumns,
  createBrowserPreviewModalSession,
  createBrowserPreviewModalChrome,
  disposeBrowserPreviewModalWidgetInstances,
  handleBrowserPreviewModalChromeAction,
  navigateBrowserPreviewModalDirectory,
  openBrowserPreviewModalSurface,
  projectBrowserPreviewModalBrowserState,
  projectBrowserPreviewModalPreview,
  applyBrowserPreviewModalPreviewProjection,
  replaceBrowserPreviewModalWidgetInstances,
  resolveBrowserPreviewModalLiveMode,
  syncBrowserPreviewModalCursorFromWidgetState,
} from '../src/dashboard/modals/browser-preview-modal-seams.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import {
  createWorkingDirState,
  refreshWorkingDir,
  type FsEntry,
} from '../src/working-dir/index.js';
import { DEFAULT_THEME_TOKENS } from '../src/theme/tokens.js';

const ROOT = join(tmpdir(), `monad-browser-preview-modal-seams-${Date.now()}`);
const CHILD = join(ROOT, 'child');
const FILE_A = join(ROOT, 'a.txt');
const FILE_B = join(CHILD, 'b.md');

beforeAll(() => {
  mkdirSync(CHILD, { recursive: true });
  writeFileSync(FILE_A, 'alpha\nbeta');
  writeFileSync(FILE_B, '# heading\nbody');
});

afterAll(() => {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
});

function fmtEntryColored(entry: FsEntry): string {
  return entry.isDir ? `[dir] ${entry.name}` : `[file] ${entry.name}`;
}

function iconForEntry(entry: FsEntry): string {
  return entry.isDir ? 'D' : 'F';
}

describe('browser preview modal seams', () => {
  test('projects browser widget state from modal working dir', () => {
    const wd = createWorkingDirState(ROOT);
    refreshWorkingDir(wd);
    wd.cursor = 1;
    wd.offset = 2;
    wd.selected.add(FILE_A);

    const projection = projectBrowserPreviewModalBrowserState(wd, {
      browserWidgetInstanceId: 'wd-browser',
      fmtEntryColored,
      iconForEntry,
    });

    expect(projection.cursor).toBe(1);
    expect(projection.offset).toBe(2);
    expect(projection.items.length).toBe(wd.entries.length);
    expect(projection.icons).toContain('D');
    expect(projection.icons).toContain('F');
    expect(projection.selected.has('[file] a.txt')).toBe(true);
    expect(projection.submitText.some((text) => text === `file-attach:@wd-browser:${FILE_A}`)).toBe(true);
  });

  test('projects file preview from modal working dir cursor', () => {
    const wd = createWorkingDirState(ROOT);
    refreshWorkingDir(wd);
    const fileCursor = wd.entries.findIndex((entry) => entry.absPath === FILE_A);
    expect(fileCursor).toBeGreaterThanOrEqual(0);

    const projection = projectBrowserPreviewModalPreview(wd, fileCursor);

    expect(projection.character).toBe('Preview');
    expect(projection.state.text).toContain('a.txt');
    expect(projection.state.text).toContain('alpha');
    expect(projection.state.preformatted).toBe(true);
  });

  test('projects directory preview from modal working dir cursor', () => {
    const wd = createWorkingDirState(ROOT);
    refreshWorkingDir(wd);
    const dirCursor = wd.entries.findIndex((entry) => entry.absPath === CHILD);
    expect(dirCursor).toBeGreaterThanOrEqual(0);

    const projection = projectBrowserPreviewModalPreview(wd, dirCursor);

    expect(projection.character).toBe('Preview · Directory');
    expect(projection.state.text).toContain('child');
    expect(projection.state.text).toContain('b.md');
  });

  test('applies preview projection into preview pane model state', () => {
    const wd = createWorkingDirState(ROOT);
    refreshWorkingDir(wd);
    const fileCursor = wd.entries.findIndex((entry) => entry.absPath === FILE_A);
    const entry = wd.entries[fileCursor] ?? null;
    const projection = projectBrowserPreviewModalPreview(wd, fileCursor);
    const preview = {
      id: 'wd-preview::pane-multi-modal',
      mode: 'modal' as const,
      followCursor: true,
      pinned: false,
      sourceMode: 'smart' as const,
      lastBrowserFocus: 'browser' as const,
      previewPath: null as string | null,
      previewLines: [] as string[],
      previewOffset: 99,
    };

    applyBrowserPreviewModalPreviewProjection(preview, projection, entry);

    expect(preview.previewPath).toBe(FILE_A);
    expect(preview.previewLines).toEqual(projection.state.text.split('\n'));
    expect(preview.previewOffset).toBe(0);
  });

  test('syncs cursor and offset back into modal working dir from widget state', () => {
    const wd = createWorkingDirState(ROOT);
    refreshWorkingDir(wd);
    wd.cursor = 0;
    wd.offset = 0;

    const result = syncBrowserPreviewModalCursorFromWidgetState(wd, {
      cursor: 999,
      offset: 3,
    });

    expect(result).not.toBeNull();
    expect(result?.prevCursor).toBe(0);
    expect(result?.nextCursor).toBe(wd.entries.length - 1);
    expect(wd.cursor).toBe(wd.entries.length - 1);
    expect(wd.offset).toBe(3);
  });

  test('navigates modal directory independently and resets cursor window', () => {
    const wd = createWorkingDirState(ROOT);
    refreshWorkingDir(wd);
    const dirCursor = wd.entries.findIndex((entry) => entry.absPath === CHILD);
    expect(dirCursor).toBeGreaterThanOrEqual(0);
    wd.cursor = dirCursor;
    wd.offset = 5;

    const into = navigateBrowserPreviewModalDirectory(wd, 'right');

    expect(into.changed).toBe(true);
    expect(wd.cwd).toBe(CHILD);
    expect(wd.cursor).toBe(0);
    expect(wd.offset).toBe(0);

    const back = navigateBrowserPreviewModalDirectory(wd, 'left');
    expect(back.changed).toBe(true);
    expect(wd.cwd).toBe(ROOT);
  });

  test('creates chrome spec with live/snapshot status text', () => {
    expect(createBrowserPreviewModalChrome(true, DEFAULT_THEME_TOKENS).bottomStatus).toBe('browser · preview · live');
    expect(createBrowserPreviewModalChrome(false, DEFAULT_THEME_TOKENS).bottomStatus).toBe('browser · preview · snapshot');
  });

  test('creates canonical widget ids from browser widget id', () => {
    expect(createBrowserPreviewModalWidgetIds('wd-browser')).toEqual({
      browserWidgetInstanceId: 'wd-browser',
      modalBrowserWidgetInstanceId: 'wd-browser::pane-multi-modal',
      modalPreviewWidgetInstanceId: 'wd-preview::pane-multi-modal',
    });
  });

  test('live mode resolver defaults on and respects explicit off', () => {
    expect(resolveBrowserPreviewModalLiveMode(undefined)).toBe(true);
    expect(resolveBrowserPreviewModalLiveMode('ON')).toBe(true);
    expect(resolveBrowserPreviewModalLiveMode('off')).toBe(false);
  });

  test('runtime host owns handle and popup dispose refs', () => {
    const events: string[] = [];
    const runtime = createBrowserPreviewModalRuntimeHost({
      onDraw: () => { events.push('draw'); },
    });
    runtime.setHandle({ dispose() { events.push('dispose-handle'); } });
    runtime.setPopupDispose(() => { events.push('dispose-popup'); });

    expect(runtime.getHandle()).not.toBeNull();
    expect(runtime.getPopupDispose()).not.toBeNull();

    runtime.closeHandleAndDraw();
    runtime.getPopupDispose()?.();

    expect(events).toEqual(['dispose-handle', 'draw', 'dispose-popup']);
  });

  test('replaces modal widget instances from source widgets only', () => {
    const disposed: string[] = [];
    const spawned: string[] = [];
    const host = {
      get(id: string) {
        if (id === 'wd-browser') return { type: 'list', character: 'Browser', config: { a: 1 } };
        if (id === 'wd-preview') return { type: 'preview', character: 'Preview', config: { b: 2 } };
        return null;
      },
      spawn(widget: { id: string }) { spawned.push(widget.id); },
      dispose(id: string) { disposed.push(`fallback:${id}`); },
      disposeById(id: string) { disposed.push(id); },
    };

    const result = replaceBrowserPreviewModalWidgetInstances(host, {
      browserWidgetInstanceId: 'wd-browser',
      modalBrowserWidgetInstanceId: 'wd-browser::pane-multi-modal',
      modalPreviewWidgetInstanceId: 'wd-preview::pane-multi-modal',
    });

    expect(result).toEqual({ hasBrowserWidget: true, hasPreviewWidget: true });
    expect(disposed).toEqual([
      'wd-browser::pane-multi-modal',
      'wd-preview::pane-multi-modal',
    ]);
    expect(spawned).toEqual([
      'wd-browser::pane-multi-modal',
      'wd-preview::pane-multi-modal',
    ]);
  });

  test('disposes modal widget instances with fallback path', () => {
    const disposed: string[] = [];
    const host = {
      get() { return null; },
      spawn() {},
      dispose(id: string) { disposed.push(`fallback:${id}`); },
      disposeById(_id: string) { throw new Error('no by id'); },
    };

    disposeBrowserPreviewModalWidgetInstances(host, {
      modalBrowserWidgetInstanceId: 'a',
      modalPreviewWidgetInstanceId: 'b',
    }, 'close');

    expect(disposed).toEqual(['fallback:a', 'fallback:b']);
  });

  test('handles chrome actions through explicit callbacks', () => {
    let model = 0;
    let close = 0;
    expect(handleBrowserPreviewModalChromeAction(
      { controlId: 'model', area: 'title-control', anchorStartCol: 0, anchorEndCol: 0, anchorRow: 0, bounds: { row: 0, col: 0, width: 0, height: 0 } },
      { onModel: () => { model += 1; }, onClose: () => { close += 1; } },
    )).toBe(true);
    expect(handleBrowserPreviewModalChromeAction(
      { controlId: 'close', area: 'title-control', anchorStartCol: 0, anchorEndCol: 0, anchorRow: 0, bounds: { row: 0, col: 0, width: 0, height: 0 } },
      { onModel: () => { model += 1; }, onClose: () => { close += 1; } },
    )).toBe(true);
    expect(handleBrowserPreviewModalChromeAction(
      { controlId: 'noop', area: 'title-control', anchorStartCol: 0, anchorEndCol: 0, anchorRow: 0, bounds: { row: 0, col: 0, width: 0, height: 0 } },
      { onModel: () => { model += 1; }, onClose: () => { close += 1; } },
    )).toBe(false);
    expect(model).toBe(1);
    expect(close).toBe(1);
  });

  test('session helper owns close, submit, and chrome orchestration', () => {
    const events: string[] = [];
    let popupDispose: (() => void) | null = () => { events.push('popup-dispose'); };
    let handleDisposed = 0;
    const session = createBrowserPreviewModalSession({
      widgetHost: {
        dispose(id: string) { events.push(`dispose:${id}`); },
        disposeById(id: string) { events.push(`disposeById:${id}`); },
      },
      modalWidgetIds: {
        modalBrowserWidgetInstanceId: 'modal-browser',
        modalPreviewWidgetInstanceId: 'modal-preview',
      },
      clearContextMenuCursorResolver: () => { events.push('clear-cursor-resolver'); },
      clearCloseRequest: () => { events.push('clear-close-request'); },
      getPopupDispose: () => popupDispose,
      setPopupDispose: (dispose) => { popupDispose = dispose; events.push(`set-popup:${dispose ? 'fn' : 'null'}`); },
      deleteModalWorkingDir: () => { events.push('delete-working-dir'); },
      deleteModalPreview: () => { events.push('delete-preview'); },
      resolveNextFocus: () => ({ nextFocus: 'log', currentFocus: 'input' }),
      applyNextFocus: (nextFocus) => { events.push(`apply-focus:${nextFocus}`); },
      onDraw: () => { events.push('draw'); },
      onSubmit: (text) => { events.push(`submit:${text}`); },
      onOpenModelPicker: () => { events.push('open-model-picker'); },
      getHandle: () => ({ dispose() { handleDisposed += 1; events.push('handle-dispose'); } }),
      debug: {
        enabled: true,
        log(scope: string, message: string) { events.push(`debug:${scope}:${message}`); },
      },
      debugMeta: {
        preFocus: 'input',
        tabletMode: false,
      },
    });

    session.handleSubmit('file-attach:/tmp/a');
    session.requestClose();
    session.handleChromeAction(
      { controlId: 'model', area: 'title-control', anchorStartCol: 0, anchorEndCol: 0, anchorRow: 0, bounds: { row: 0, col: 0, width: 0, height: 0 } },
    );
    session.handleChromeAction(
      { controlId: 'close', area: 'title-control', anchorStartCol: 0, anchorEndCol: 0, anchorRow: 0, bounds: { row: 0, col: 0, width: 0, height: 0 } },
    );
    session.onDispose();

    expect(handleDisposed).toBe(3);
    expect(events).toContain('submit:file-attach:/tmp/a');
    expect(events).toContain('open-model-picker');
    expect(events).toContain('clear-cursor-resolver');
    expect(events).toContain('clear-close-request');
    expect(events).toContain('delete-working-dir');
    expect(events).toContain('delete-preview');
    expect(events).toContain('apply-focus:log');
    expect(events).toContain('debug:tablet.pane-multi.dispose:Ctrl+M B');
  });

  test('live columns helper wires intercept, submit, and preview fallback', () => {
    const events: string[] = [];
    const columns = createBrowserPreviewModalLiveColumns({
      browserWidgetInstanceId: 'wd-browser',
      modalBrowserWidgetInstanceId: 'wd-browser::pane-multi-modal',
      modalPreviewWidgetInstanceId: 'wd-preview::pane-multi-modal',
      hasBrowserWidget: true,
      hasPreviewWidget: false,
      modalWorkingDir: { entries: [{ name: 'a', absPath: '/a', isDir: false, size: 0, mtime: 0, ext: 'txt' }] },
      navigate: () => ({ changed: true, direction: 'left', cwd: '/tmp' }),
      syncBrowserWidgetFromState: () => { events.push('sync-browser'); },
      syncPreviewFromCursor: (cursor) => { events.push(`sync-preview:${cursor}`); },
      afterBrowserInteraction: () => { events.push('after-browser'); },
      onSubmit: (text) => { events.push(`submit:${text}`); },
      onDraw: () => { events.push('draw'); },
      onRightClick: () => ({ type: 'refresh' }),
      debug: {
        enabled: true,
        log(scope: string, message: string) { events.push(`debug:${scope}:${message}`); },
      },
    });

    expect(columns).toHaveLength(2);
    expect(columns[0]?.widgetInstanceId).toBe('wd-browser::pane-multi-modal');
    expect(columns[1]?.widgetInstanceId).toBe('wd-preview');
    expect(columns[0]?.onIntercept?.({ name: 'left' } as never)).toBe('consumed');
    columns[0]?.onAfterKey?.({ type: 'submit', text: 'x' } as never, {} as never);
    expect(columns[0]?.onRightClick?.({} as never, { localRow: 0, localCol: 0, cellIndex: 0 })).toEqual({ type: 'refresh' });

    expect(events).toContain('sync-browser');
    expect(events).toContain('sync-preview:0');
    expect(events).toContain('draw');
    expect(events).toContain('after-browser');
    expect(events).toContain('submit:x');
    expect(events).toContain('debug:tablet.pane-multi.browser.nav:parent');
  });

  test('snapshot columns helper captures browser and preview panes', () => {
    const columns = createBrowserPreviewModalSnapshotColumns((pane) =>
      pane === 'browser' ? 'b1\nb2' : 'p1',
    );

    expect(columns).toEqual([
      { title: 'browser', lines: ['b1', 'b2'], weight: 2 },
      { title: 'preview', lines: ['p1'], weight: 3 },
    ]);
  });

  test('open bindings helper owns cancel and chrome forwarding', () => {
    const events: string[] = [];
    const bindings = createBrowserPreviewModalOpenBindings({
      onDraw: () => { events.push('draw'); },
      getHandle: () => ({ dispose() { events.push('dispose'); } }),
      onChromeAction: (action) => { events.push(`chrome:${action.controlId}`); },
    });

    bindings.onCancel();
    bindings.onChromeAction({
      controlId: 'model',
      area: 'title-control',
      anchorStartCol: 0,
      anchorEndCol: 0,
      anchorRow: 0,
      bounds: { row: 0, col: 0, width: 0, height: 0 },
    });

    expect(events).toEqual(['dispose', 'draw', 'chrome:model']);
  });

  test('modal surface helper selects snapshot path when live mode is off', () => {
    const coordinator = new DisplayCoordinator();
    const handle = openBrowserPreviewModalSurface({
      liveMode: false,
      title: 'Browser + Preview',
      layoutMode: '2x1',
      chrome: createBrowserPreviewModalChrome(false, DEFAULT_THEME_TOKENS),
      group: 'test-pane-multi-modal',
      coordinator,
      termCols: 100,
      termRows: 40,
      onDispose: () => {},
      onCancel: () => {},
      onChromeAction: () => {},
      widgetHost: {
        get() { return null; },
        defFor() { return null; },
      },
      liveColumns: [],
      snapshotColumns: createBrowserPreviewModalSnapshotColumns(() => 'line'),
    });

    expect(handle).not.toBeNull();
    handle.dispose();
  });
});
