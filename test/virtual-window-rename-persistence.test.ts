// VW-B3/B4 — rename persistence via user-config.
//
// Covers WindowRegistry lookup + save hooks (VwRenamePersistence)
// and the user-config sink that backs them in production.

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WindowRegistry, type VwRenamePersistence } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import {
  buildUserConfig,
  saveUserConfig,
  setVwWindowName,
  setVwPaneName,
  vwPaneKey,
} from '../src/user-config.js';

function fakePersistence(): VwRenamePersistence & {
  calls: string[];
  windows: Map<string, string>;
  panes: Map<string, string>;
} {
  const windows = new Map<string, string>();
  const panes = new Map<string, string>();
  const calls: string[] = [];
  return {
    windows,
    panes,
    calls,
    lookupWindowName(spawn: string) {
      calls.push(`lookupWindow(${spawn})`);
      return windows.get(spawn);
    },
    saveWindowName(spawn: string, next: string) {
      calls.push(`saveWindow(${spawn},${next})`);
      windows.set(spawn, next);
    },
    lookupPaneName(win: string, pane: string) {
      calls.push(`lookupPane(${win}|${pane})`);
      return panes.get(`${win}|${pane}`);
    },
    savePaneName(win: string, pane: string, next: string) {
      calls.push(`savePane(${win}|${pane},${next})`);
      panes.set(`${win}|${pane}`, next);
    },
  };
}

function setup(persistence?: VwRenamePersistence) {
  const coord = new DisplayCoordinator({ frameMs: 0 });
  const book = createAddressBook();
  const reg = new WindowRegistry({
    addressBook: book,
    coordinator: coord,
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
    persistence,
  });
  return { coord, reg, book };
}

describe('VW-B3 window rename persistence', () => {
  test('spawn with no persisted override uses spec.title unchanged', () => {
    const p = fakePersistence();
    const { reg } = setup(p);
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: 'x' } });
    expect(w.title).toBe('runner');
    expect(p.calls).toContain('lookupWindow(runner)');
  });

  test('spawn applies persisted rename when spawn title matches', () => {
    const p = fakePersistence();
    p.windows.set('runner', 'dev-server');
    const { reg, book } = setup(p);
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: 'x' } });
    expect(w.title).toBe('dev-server');
    // AddressBook reflects the displayed title, not the spawn title.
    expect(book.resolveWindow(w.id)?.title).toBe('dev-server');
  });

  test('renameWindow persists using the spawn title key', () => {
    const p = fakePersistence();
    const { reg } = setup(p);
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: 'x' } });
    reg.renameWindow(w.id, 'dev-server');
    expect(p.calls).toContain('saveWindow(runner,dev-server)');
    expect(p.windows.get('runner')).toBe('dev-server');
  });

  test('spawnTitleOf returns the original spec.title even after rename', () => {
    const p = fakePersistence();
    const { reg } = setup(p);
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: 'x' } });
    reg.renameWindow(w.id, 'dev-server');
    expect(reg.spawnTitleOf(w.id)).toBe('runner');
  });

  test('no persistence dep → registry still works (fallback path)', () => {
    const { reg } = setup(); // no persistence
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: 'x' } });
    expect(reg.renameWindow(w.id, 'dev-server')).toBe(true);
    expect(w.title).toBe('dev-server');
    // spawnTitleOf still tracks the key locally.
    expect(reg.spawnTitleOf(w.id)).toBe('runner');
  });
});

describe('VW-B4 pane title persistence lookup on spawn', () => {
  test('persisted pane override applied to root pane at spawn', () => {
    const p = fakePersistence();
    p.panes.set('runner|markdown', 'notes');
    const { reg } = setup(p);
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: 'x' } });
    const rootId = w.listPanes()[0]!.id;
    expect(w.getPaneDisplayTitle(rootId)).toBe('notes');
  });

  test('renamePane() persists override keyed by spawn title + content title', () => {
    const p = fakePersistence();
    const { reg } = setup(p);
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: 'x' } });
    const rootId = w.listPanes()[0]!.id;
    const ok = reg.renamePane(w.id, rootId, 'my-notes');
    expect(ok).toBe(true);
    expect(w.getPaneDisplayTitle(rootId)).toBe('my-notes');
    expect(p.panes.get('runner|markdown')).toBe('my-notes');
  });

  test('renamePane() with empty string clears both override + persisted entry', () => {
    const p = fakePersistence();
    p.panes.set('runner|markdown', 'old');
    const { reg } = setup(p);
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: 'x' } });
    const rootId = w.listPanes()[0]!.id;
    expect(w.getPaneDisplayTitle(rootId)).toBe('old');
    reg.renamePane(w.id, rootId, '');
    expect(w.getPaneDisplayTitle(rootId)).toBe('markdown');
    // Persistence save called with '' — fake persistence stores it,
    // production setter treats empty as delete.
    expect(p.calls).toContain('savePane(runner|markdown,)');
  });

  test('renamePane() returns false for unknown window / pane', () => {
    const { reg } = setup();
    expect(reg.renamePane(999 as never, 'nope', 'x')).toBe(false);
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: 'x' } });
    expect(reg.renamePane(w.id, 'nope-pane', 'x')).toBe(false);
  });

  test('split-born pane applies persisted override on create', async () => {
    const { createPaneContent } = await import('../src/virtual-windows/pane-content.js');
    const p = fakePersistence();
    p.panes.set('runner|scratch', 'extra');
    const { reg } = setup(p);
    const w = reg.spawn({ title: 'runner', initialContent: { kind: 'markdown', text: 'root', title: 'root' } });
    const rootId = w.listPanes()[0]!.id;
    // Root pane title 'root' has no override.
    expect(w.getPaneDisplayTitle(rootId)).toBe('root');
    // Split in a scratch pane (default title = 'scratch') — override applies.
    const newPane = createPaneContent({ kind: 'scratch' });
    const newPaneId = w.splitFocused('v', newPane);
    expect(w.getPaneDisplayTitle(newPaneId)).toBe('extra');
  });
});

// ── user-config sink ────────────────────────────────────────────

describe('user-config vw section', () => {
  test('round-trips windowNames + paneNames through save/load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elanous-vw-cfg-'));
    const path = join(dir, 'config.json');
    let cfg = buildUserConfig(path);
    cfg = setVwWindowName(cfg, 'runner', 'dev-server');
    cfg = setVwPaneName(cfg, vwPaneKey('runner', 'markdown'), 'notes');
    cfg = {
      ...cfg,
      vw: {
        ...cfg.vw,
        entries: {
          acp: { resident: false, foregroundOnStartup: false },
          sim: { resident: cfg.vw.simResident, foregroundOnStartup: false },
          iul: { resident: cfg.vw.iulResident, foregroundOnStartup: cfg.vw.iulForegroundOnStartup },
        },
      },
    };
    saveUserConfig(cfg, path);
    expect(existsSync(path)).toBe(true);
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    expect((raw.vw as Record<string, unknown>).windowNames).toEqual({ runner: 'dev-server' });
    expect((raw.vw as Record<string, unknown>).paneNames).toEqual({ 'runner|markdown': 'notes' });
    expect(((raw.vw as Record<string, unknown>).acp as Record<string, unknown>).resident).toBe(false);
    const reloaded = buildUserConfig(path);
    expect(reloaded.vw.windowNames.runner).toBe('dev-server');
    expect(reloaded.vw.paneNames[vwPaneKey('runner', 'markdown')]).toBe('notes');
    expect(reloaded.vw.entries.acp.resident).toBe(false);
  });

  test('setVwWindowName with empty string removes the entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elanous-vw-cfg-'));
    const path = join(dir, 'config.json');
    let cfg = buildUserConfig(path);
    cfg = setVwWindowName(cfg, 'runner', 'dev-server');
    cfg = setVwWindowName(cfg, 'runner', '');
    saveUserConfig(cfg, path);
    const reloaded = buildUserConfig(path);
    expect(reloaded.vw.windowNames.runner).toBeUndefined();
  });

  test('vw section omitted from JSON when both maps are empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elanous-vw-cfg-'));
    const path = join(dir, 'config.json');
    const cfg = buildUserConfig(path);
    saveUserConfig(cfg, path);
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    expect(raw.vw).toBeUndefined();
  });

  test('vw resident flag defaults to true when omitted or malformed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elanous-vw-cfg-'));
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({
      vw: { acp: { resident: 'nope' }, windowNames: {}, paneNames: {} },
    }));
    const cfg = buildUserConfig(path);
    expect(cfg.vw.entries.acp.resident).toBe(true);
  });

  test('malformed values in on-disk vw section are discarded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'elanous-vw-cfg-'));
    const path = join(dir, 'config.json');
    writeFileSync(path, JSON.stringify({
      vw: { windowNames: { good: 'ok', bad: 123 }, paneNames: 'not-an-object' },
    }));
    const cfg = buildUserConfig(path);
    expect(cfg.vw.windowNames).toEqual({ good: 'ok' });
    expect(cfg.vw.paneNames).toEqual({});
  });
});
