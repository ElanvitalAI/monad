import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { DisplayCoordinator } from '../src/display/coordinator.js';
import { createBrowserPaneModel, refreshBrowserPane } from '../src/browser-pane/model.js';
import {
  createBrowserPaneContent,
  createBrowserPaneModalChrome,
  openBrowserPaneModal,
} from '../src/browser-pane/mount.js';
import { BrowserPaneRegistry } from '../src/browser-pane/registry.js';
import { DEFAULT_THEME_TOKENS } from '../src/theme/tokens.js';

const ROOT = join(tmpdir(), `elanous-browser-pane-mount-${Date.now()}`);
const CHILD = join(ROOT, 'child');
const FILE_A = join(ROOT, 'a.txt');

beforeAll(() => {
  mkdirSync(CHILD, { recursive: true });
  writeFileSync(FILE_A, 'alpha');
});

afterAll(() => {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('browser pane mount', () => {
  test('renders registry-backed browser content and moves cursor', () => {
    const registry = new BrowserPaneRegistry();
    const state = createBrowserPaneModel(ROOT);
    refreshBrowserPane(state);
    registry.register('vw-browser:test', state);
    const pane = createBrowserPaneContent(
      { kind: 'vw-browser', browserId: 'vw-browser:test', title: 'browser' },
      { browserPaneRegistry: registry },
    );

    const first = pane.render({ cols: 60, rows: 6, focused: true });
    expect(first).toContain('child');

    pane.onKey({ name: 'down' } as never);
    expect(state.cursor).toBe(1);
  });

  test('enter on a directory refreshes the cloned browser model', () => {
    const registry = new BrowserPaneRegistry();
    const state = createBrowserPaneModel(ROOT);
    refreshBrowserPane(state);
    registry.register('vw-browser:test', state);
    const pane = createBrowserPaneContent(
      { kind: 'vw-browser', browserId: 'vw-browser:test', title: 'browser' },
      { browserPaneRegistry: registry },
    );

    const childIndex = state.entries.findIndex((entry) => entry.absPath === CHILD);
    expect(childIndex).toBeGreaterThan(0);
    for (let i = 0; i < childIndex; i++) pane.onKey({ name: 'down' } as never);
    pane.onKey({ name: 'enter' } as never);

    expect(state.cwd).toBe(CHILD);
    expect(state.cursor).toBe(0);
  });

  test('space toggles file selection on the cloned browser model', () => {
    const registry = new BrowserPaneRegistry();
    const state = createBrowserPaneModel(ROOT);
    refreshBrowserPane(state);
    registry.register('vw-browser:test', state);
    const pane = createBrowserPaneContent(
      { kind: 'vw-browser', browserId: 'vw-browser:test', title: 'browser' },
      { browserPaneRegistry: registry },
    );

    const fileIndex = state.entries.findIndex((entry) => entry.absPath === FILE_A);
    expect(fileIndex).toBeGreaterThan(0);
    for (let i = 0; i < fileIndex; i++) pane.onKey({ name: 'down' } as never);
    pane.onKey({ name: ' ' } as never);

    expect([...state.selected]).toEqual([FILE_A]);
  });

  test('snapshot browser modal opens as a single-column popup', () => {
    const coordinator = new DisplayCoordinator({ frameMs: 0 });
    const registry = new BrowserPaneRegistry();
    const state = createBrowserPaneModel(ROOT);
    refreshBrowserPane(state);
    registry.register('wd-browser', state);

    const handle = openBrowserPaneModal({
      browserWidgetInstanceId: 'wd-browser',
      liveMode: false,
      browserPaneRegistry: registry,
      widgetHost: {
        get() { return null; },
        spawn() {},
        dispose() {},
        disposeById() {},
        defFor() { return null; },
      },
      coordinator,
      termCols: 120,
      termRows: 40,
      captureSnapshot: () => 'child\na.txt',
      theme: DEFAULT_THEME_TOKENS,
      fmtEntryColored: (entry) => entry.name,
      iconForEntry: () => '',
    });

    expect(handle.columnCount).toBe(1);
    handle.dispose();
  });

  test('creates chrome spec with live/snapshot status text', () => {
    expect(createBrowserPaneModalChrome(DEFAULT_THEME_TOKENS, true).bottomStatus).toBe('browser · live');
    expect(createBrowserPaneModalChrome(DEFAULT_THEME_TOKENS, false).bottomStatus).toBe('browser · snapshot');
  });
});
