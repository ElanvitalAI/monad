// ── BrowserPaneRegistry · per-instance browser state ──
//
// Covers the seam introduced for the browser instance scoping fix:
// each browser widget instance owns its own `WorkingDirState` so a
// modal browser can navigate without mutating the underlying default
// browser's cwd / entries / preview, and 3+ concurrent instances are
// addressable by id.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  enterBrowserDirectory,
  refreshBrowserPane,
  createBrowserPaneModel,
} from '../src/browser-pane/model.js';
import {
  cloneBrowserPaneModel,
  BrowserPaneRegistry,
} from '../src/browser-pane/registry.js';

const ROOT = join(tmpdir(), `monad-wd-registry-test-${Date.now()}`);
const SUB_A = join(ROOT, 'sub-a');
const SUB_B = join(ROOT, 'sub-b');

beforeAll(() => {
  mkdirSync(SUB_A, { recursive: true });
  mkdirSync(SUB_B, { recursive: true });
  writeFileSync(join(ROOT, 'a.txt'), 'alpha');
  writeFileSync(join(SUB_A, 'inside.txt'), 'inside-a');
  writeFileSync(join(SUB_B, 'inside.txt'), 'inside-b');
});

afterAll(() => {
  try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('cloneBrowserPaneModel', () => {
  test('clone is a deep copy of mutable fields', () => {
    const a = createBrowserPaneModel(ROOT);
    refreshBrowserPane(a);
    a.cursor = 2;
    a.offset = 1;
    a.selected.add('/abs/path');

    const b = cloneBrowserPaneModel(a);

    // Same data shape
    expect(b.cwd).toBe(a.cwd);
    expect(b.cursor).toBe(2);
    expect(b.offset).toBe(1);
    expect(b.selected.has('/abs/path')).toBe(true);

    // But independent references — mutating one MUST NOT touch the
    // other (this is the whole point of the modal-vs-default split).
    b.cursor = 7;
    b.selected.add('/another/path');
    b.entries.push({
      name: 'fake', absPath: '/x', isDir: false, size: 0, mtime: 0, ext: '',
    });

    expect(a.cursor).toBe(2);
    expect(a.selected.has('/another/path')).toBe(false);
    expect(a.entries).not.toContainEqual(expect.objectContaining({ name: 'fake' }));
  });
});

describe('BrowserPaneRegistry', () => {
  test('register + get round-trips by id', () => {
    const reg = new BrowserPaneRegistry();
    const wd = createBrowserPaneModel(ROOT);
    reg.register('wd-browser', wd);
    expect(reg.get('wd-browser')).toBe(wd);
    expect(reg.get('missing')).toBeNull();
  });

  test('ensure allocates a fresh state when the id is unknown', () => {
    const reg = new BrowserPaneRegistry();
    const wd = reg.ensure('wd-browser', { cwd: ROOT });
    expect(wd.cwd).toBe(ROOT);
    // Idempotent — second call returns the same instance.
    expect(reg.ensure('wd-browser')).toBe(wd);
  });

  test('cloneInto produces an isolated state — modal navigation does not leak', () => {
    const reg = new BrowserPaneRegistry();
    const source = createBrowserPaneModel(ROOT);
    refreshBrowserPane(source);
    reg.register('wd-browser', source);

    const modalId = 'wd-browser::pane-multi-modal';
    const modal = reg.cloneInto('wd-browser', modalId);

    // Both look at the same cwd at clone time.
    expect(modal.cwd).toBe(source.cwd);

    // Navigate the MODAL into a child directory.
    enterBrowserDirectory(modal, SUB_A);
    refreshBrowserPane(modal);

    // Default browser's cwd is untouched.
    expect(source.cwd).toBe(ROOT);
    expect(modal.cwd).toBe(SUB_A);

    // And in the other direction — navigating the default does not
    // drag the modal along.
    enterBrowserDirectory(source, SUB_B);
    refreshBrowserPane(source);
    expect(source.cwd).toBe(SUB_B);
    expect(modal.cwd).toBe(SUB_A);
  });

  test('cloneInto throws when the source id is missing', () => {
    const reg = new BrowserPaneRegistry();
    expect(() => reg.cloneInto('nope', 'modal')).toThrow();
  });

  test('delete cleans up — modal close stops leaking state across opens', () => {
    const reg = new BrowserPaneRegistry();
    const source = createBrowserPaneModel(ROOT);
    reg.register('wd-browser', source);
    reg.cloneInto('wd-browser', 'wd-browser::pane-multi-modal');

    expect(reg.size()).toBe(2);
    expect(reg.delete('wd-browser::pane-multi-modal')).toBe(true);
    expect(reg.size()).toBe(1);
    expect(reg.get('wd-browser::pane-multi-modal')).toBeNull();
    // Idempotent on the second call.
    expect(reg.delete('wd-browser::pane-multi-modal')).toBe(false);
  });

  test('supports 3+ concurrent independent instances', () => {
    // The user explicitly called out: "멀티플 즉 3개 이상이 생길수도 있으니"
    const reg = new BrowserPaneRegistry();
    const a = createBrowserPaneModel(ROOT);
    reg.register('browser-a', a);
    const b = reg.cloneInto('browser-a', 'browser-b');
    const c = reg.cloneInto('browser-a', 'browser-c');

    enterBrowserDirectory(a, ROOT);
    enterBrowserDirectory(b, SUB_A);
    enterBrowserDirectory(c, SUB_B);
    refreshBrowserPane(a);
    refreshBrowserPane(b);
    refreshBrowserPane(c);

    expect(a.cwd).toBe(ROOT);
    expect(b.cwd).toBe(SUB_A);
    expect(c.cwd).toBe(SUB_B);
    expect(reg.ids().sort()).toEqual(['browser-a', 'browser-b', 'browser-c']);
  });
});
