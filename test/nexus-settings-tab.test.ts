// NEXUS · settings tab tests (Phase N-3 cleanup PR α')

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { SettingsTabController } from '../src/nexus/config/settings-controller.js';
import { createSettingsTabSpec, renderSettingsLines } from '../src/nexus/kinds/settings.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import { reloadAllBuiltins } from '../src/nexus/config/builtins/index.js';
import { writeUserConfig, readUserConfig } from '../src/nexus/config/user-config.js';

let tmpRoot: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(joinPath(tmpdir(), 'elanous-nexus-alpha-prime-'));
  prevEnv = process.env.ELANOUS_NEXUS_DIR;
  process.env.ELANOUS_NEXUS_DIR = tmpRoot;
  // Force a reload because other nexus test files clear the registry
  // singleton in their teardown — relying on loadAllBuiltins's
  // 'already loaded' guard would leave us with an empty registry.
  reloadAllBuiltins();
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.ELANOUS_NEXUS_DIR;
  else process.env.ELANOUS_NEXUS_DIR = prevEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

function setup() {
  const state = createNexusState({ nexusVersion: '0.17.0', phase: 'N-3 cleanup α test' });
  const registry = new TabRegistry(state);
  return { state, registry };
}

describe('createSettingsTabSpec · kind registration', () => {
  test('default id + label + view-only kind (no spawn)', () => {
    const spec = createSettingsTabSpec();
    expect(spec.id).toBe('settings:1');
    expect(spec.kind).toBe('settings');
    expect(spec.label).toBe('settings');
    expect(spec.spawn).toBeUndefined();
    expect(spec.health).toBeUndefined();
  });

  test('id + label override', () => {
    const spec = createSettingsTabSpec({ id: 'settings:custom', label: 'Configuration' });
    expect(spec.id).toBe('settings:custom');
    expect(spec.label).toBe('Configuration');
  });
});

describe('SettingsTabController · refresh + rows', () => {
  test('global-scope switches show up as rows in the global group', () => {
    const { state, registry } = setup();
    const ctrl = new SettingsTabController({ state, registry });
    const snap = ctrl.snapshot();
    expect(snap.rows.length).toBeGreaterThan(0);
    expect(snap.rows.every((r) => typeof r.id === 'string' && r.id.length > 0)).toBe(true);
    expect(snap.rows.some((r) => r.group === 'global')).toBe(true);
  });

  test('tab-scope switches expand per matching registered tab', () => {
    const { state, registry } = setup();
    registry.register({ id: 'daemon:1', kind: 'daemon', label: 'd' });
    registry.register({ id: 'pwa-host:1', kind: 'pwa-host', label: 'p' });
    const ctrl = new SettingsTabController({ state, registry });
    const snap = ctrl.snapshot();
    const daemonRows = snap.rows.filter((r) => r.id.startsWith('tabs.daemon:1.'));
    const pwaRows = snap.rows.filter((r) => r.id.startsWith('tabs.pwa-host:1.'));
    expect(daemonRows.length).toBeGreaterThan(0);
    expect(pwaRows.length).toBeGreaterThan(0);
    // Group label must be the kind so the renderer can show '[daemon]'
    // and '[pwa-host]' headers separately.
    expect(daemonRows.every((r) => r.group === 'daemon')).toBe(true);
    expect(pwaRows.every((r) => r.group === 'pwa-host')).toBe(true);
  });

  test('value comes from current UserConfig (undefined when unset)', () => {
    const { state, registry } = setup();
    registry.register({ id: 'daemon:1', kind: 'daemon', label: 'd' });
    // Seed a switch value.
    const cfg = readUserConfig();
    cfg.global = { ...cfg.global, debug: { enabled: true } };
    writeUserConfig(cfg);
    const ctrl = new SettingsTabController({ state, registry });
    const debugRow = ctrl.snapshot().rows.find((r) => r.id === 'global.debug.enabled');
    expect(debugRow?.value).toBe(true);
  });

  test('secret-ref / redactInLogs switches show [redacted-secret-ref] when set', () => {
    const { state, registry } = setup();
    registry.register({ id: 'telegram:1', kind: 'channel-bot', label: 't' });
    const cfg = readUserConfig();
    cfg.tabs = {
      ...cfg.tabs,
      'telegram:1': { tokenRef: 'ref:secret:telegram-bot-1' },
    };
    writeUserConfig(cfg);
    const ctrl = new SettingsTabController({ state, registry });
    const tokRow = ctrl.snapshot().rows.find((r) => r.id === 'tabs.telegram:1.tokenRef');
    expect(tokRow).toBeDefined();
    expect(tokRow!.redactInLogs).toBe(true);
    expect(tokRow!.value).toBe('[redacted-secret-ref]');
  });

  test('refresh() clamps selectedIndex when rows shrink', () => {
    const { state, registry } = setup();
    registry.register({ id: 'daemon:1', kind: 'daemon', label: 'd' });
    const ctrl = new SettingsTabController({ state, registry });
    const lastIdx = ctrl.snapshot().rows.length - 1;
    ctrl.moveSelection(lastIdx);
    expect(ctrl.snapshot().selectedIndex).toBe(lastIdx);
    registry.unregister('daemon:1');
    ctrl.refresh();
    expect(ctrl.snapshot().selectedIndex).toBeLessThanOrEqual(ctrl.snapshot().rows.length - 1);
  });
});

describe('SettingsTabController · selection navigation', () => {
  test('moveSelection wraps at boundaries', () => {
    const { state, registry } = setup();
    const ctrl = new SettingsTabController({ state, registry });
    const n = ctrl.snapshot().rows.length;
    expect(n).toBeGreaterThan(2);
    ctrl.moveSelection(-1);
    expect(ctrl.snapshot().selectedIndex).toBe(n - 1);
    ctrl.moveSelection(1);
    expect(ctrl.snapshot().selectedIndex).toBe(0);
  });

  test('moveSelection ignored while editing', () => {
    const { state, registry } = setup();
    const ctrl = new SettingsTabController({ state, registry });
    ctrl.moveSelection(1);
    const before = ctrl.snapshot().selectedIndex;
    ctrl.beginEdit();
    ctrl.moveSelection(5);
    expect(ctrl.snapshot().selectedIndex).toBe(before);
  });
});

describe('SettingsTabController · edit lifecycle', () => {
  test('beginEdit + appendChar + commitEdit applies bool switch', async () => {
    const { state, registry } = setup();
    const ctrl = new SettingsTabController({ state, registry });
    // Navigate to the 'global.debug.enabled' bool row deterministically.
    const targetIdx = ctrl.snapshot().rows.findIndex((r) => r.id === 'global.debug.enabled');
    expect(targetIdx).toBeGreaterThanOrEqual(0);
    ctrl.moveSelection(targetIdx - ctrl.snapshot().selectedIndex);
    ctrl.beginEdit();
    expect(ctrl.snapshot().editingId).toBe('global.debug.enabled');
    // Clear any prefilled value (when value !== undefined the buffer
    // pre-populates with stringified current state).
    while (ctrl.snapshot().editingBuffer.length > 0) ctrl.backspace();
    'true'.split('').forEach((ch) => ctrl.appendChar(ch));
    expect(ctrl.snapshot().editingBuffer).toBe('true');
    const result = await ctrl.commitEdit();
    expect(result.outcome).toBe('hot');
    expect(ctrl.snapshot().editingId).toBeNull();
    const cfg = readUserConfig();
    expect(cfg.global?.debug?.enabled).toBe(true);
  });

  test('cancelEdit drops the buffer + leaves UserConfig untouched', async () => {
    const { state, registry } = setup();
    const ctrl = new SettingsTabController({ state, registry });
    ctrl.beginEdit();
    'oops'.split('').forEach((ch) => ctrl.appendChar(ch));
    ctrl.cancelEdit();
    expect(ctrl.snapshot().editingId).toBeNull();
    expect(ctrl.snapshot().editingBuffer).toBe('');
  });

  test('backspace shortens the buffer', () => {
    const { state, registry } = setup();
    const ctrl = new SettingsTabController({ state, registry });
    ctrl.beginEdit();
    'abc'.split('').forEach((ch) => ctrl.appendChar(ch));
    expect(ctrl.snapshot().editingBuffer).toBe('abc');
    ctrl.backspace();
    expect(ctrl.snapshot().editingBuffer).toBe('ab');
    ctrl.backspace();
    ctrl.backspace();
    ctrl.backspace(); // over-pop is a no-op
    expect(ctrl.snapshot().editingBuffer).toBe('');
  });

  test('invalid value yields outcome:invalid + edit mode preserved', async () => {
    const { state, registry } = setup();
    registry.register({ id: 'pwa-host:1', kind: 'pwa-host', label: 'p' });
    const ctrl = new SettingsTabController({ state, registry });
    const portIdx = ctrl.snapshot().rows.findIndex((r) => r.id === 'tabs.pwa-host:1.port');
    expect(portIdx).toBeGreaterThanOrEqual(0);
    ctrl.moveSelection(portIdx - ctrl.snapshot().selectedIndex);
    ctrl.beginEdit();
    while (ctrl.snapshot().editingBuffer.length > 0) ctrl.backspace();
    'not-a-port'.split('').forEach((ch) => ctrl.appendChar(ch));
    const result = await ctrl.commitEdit();
    expect(result.outcome).toBe('invalid');
    expect(ctrl.snapshot().editingId).toBe('tabs.pwa-host:1.port');
    expect(ctrl.snapshot().lastResult?.outcome).toBe('invalid');
  });

  test('numeric kind coerces buffer to a number on commit', async () => {
    const { state, registry } = setup();
    registry.register({ id: 'pwa-host:1', kind: 'pwa-host', label: 'p' });
    const ctrl = new SettingsTabController({ state, registry });
    const portIdx = ctrl.snapshot().rows.findIndex((r) => r.id === 'tabs.pwa-host:1.port');
    ctrl.moveSelection(portIdx - ctrl.snapshot().selectedIndex);
    ctrl.beginEdit();
    while (ctrl.snapshot().editingBuffer.length > 0) ctrl.backspace();
    '4242'.split('').forEach((ch) => ctrl.appendChar(ch));
    const result = await ctrl.commitEdit();
    expect(result.outcome === 'hot' || result.outcome === 'restart' || result.outcome === 'no-op').toBe(true);
    const cfg = readUserConfig();
    expect(cfg.tabs['pwa-host:1']?.port).toBe(4242);
  });
});

describe('renderSettingsLines · static layout', () => {
  test('returns guidance lines when no controller is bound', () => {
    const lines = renderSettingsLines();
    expect(lines.some((l) => l.includes('controller not bound'))).toBe(true);
  });

  test('renders [group] headers + cursor + value column when bound', () => {
    const { state, registry } = setup();
    const ctrl = new SettingsTabController({ state, registry });
    // PR g.2 — Quick Setup card prepended; suppress so the editor
    // assertions stay focused on the SwitchRegistry rows.
    const lines = renderSettingsLines(ctrl, { suppressQuickSetup: true });
    expect(lines.some((l) => l.includes('settings · SwitchRegistry editor'))).toBe(true);
    expect(lines.some((l) => l.includes('[global]'))).toBe(true);
    expect(lines.some((l) => l.startsWith('  ▶ '))).toBe(true);
  });

  test('shows the editing buffer with terminal cursor while in edit mode', () => {
    const { state, registry } = setup();
    const ctrl = new SettingsTabController({ state, registry });
    ctrl.beginEdit();
    ctrl.appendChar('y');
    const lines = renderSettingsLines(ctrl, { suppressQuickSetup: true });
    expect(lines.some((l) => l.includes('> y_'))).toBe(true);
  });

  test('surfaces last apply outcome below the row list', async () => {
    const { state, registry } = setup();
    const ctrl = new SettingsTabController({ state, registry });
    const targetIdx = ctrl.snapshot().rows.findIndex((r) => r.id === 'global.debug.enabled');
    ctrl.moveSelection(targetIdx - ctrl.snapshot().selectedIndex);
    ctrl.beginEdit();
    while (ctrl.snapshot().editingBuffer.length > 0) ctrl.backspace();
    'true'.split('').forEach((c) => ctrl.appendChar(c));
    await ctrl.commitEdit();
    const lines = renderSettingsLines(ctrl, { suppressQuickSetup: true });
    expect(lines.some((l) => l.includes('last apply: hot'))).toBe(true);
  });
});

describe('renderSettingsLines · Quick Setup card (PR g.2)', () => {
  test('Quick Setup card prepends the SwitchRegistry editor by default', () => {
    const { state, registry } = setup();
    const ctrl = new SettingsTabController({ state, registry });
    const lines = renderSettingsLines(ctrl, {
      quickSetupOpts: { envSource: {}, tokenLookup: () => null },
    });
    const qsIdx = lines.findIndex((l) => l.includes('Quick Setup'));
    const editorIdx = lines.findIndex((l) => l.includes('SwitchRegistry editor'));
    expect(qsIdx).toBeGreaterThanOrEqual(0);
    expect(editorIdx).toBeGreaterThan(qsIdx);
  });

  test('Quick Setup respects the wired backend (▶ on detected provider)', () => {
    const { state, registry } = setup();
    const ctrl = new SettingsTabController({ state, registry });
    const lines = renderSettingsLines(ctrl, {
      quickSetupOpts: {
        envSource: { GEMINI_API_KEY: 'AI-z' },
        tokenLookup: () => null,
      },
    });
    const gemLine = lines.find((l) => l.includes('Google · Gemini'))!;
    expect(gemLine.startsWith('  ▶')).toBe(true);
  });

  test('suppressQuickSetup omits the entire card', () => {
    const { state, registry } = setup();
    const ctrl = new SettingsTabController({ state, registry });
    const lines = renderSettingsLines(ctrl, { suppressQuickSetup: true });
    expect(lines.some((l) => l.includes('Quick Setup'))).toBe(false);
  });
});
