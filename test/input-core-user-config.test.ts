import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadUserBindings,
  listAllBindings,
  setUserConfigBindings,
  addDefaultBinding,
  getInputSettings,
  __resetBindingsForTests,
  __resetInputSettingsForTests,
} from '../src/input-core/index.js';
import type { LoadReport, LoadReporter } from '../src/input-core/user-config-loader.js';

let tmpDir: string;
let configPath: string;

beforeEach(() => {
  __resetBindingsForTests();
  __resetInputSettingsForTests();
  tmpDir = join(tmpdir(), `elanous-user-bindings-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  configPath = join(tmpDir, 'input-bindings.json');
});

afterEach(() => {
  __resetBindingsForTests();
  __resetInputSettingsForTests();
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

function write(content: string | object): void {
  writeFileSync(configPath, typeof content === 'string' ? content : JSON.stringify(content));
}

function capture(): { events: Parameters<LoadReporter>[0][]; reporter: LoadReporter } {
  const events: Parameters<LoadReporter>[0][] = [];
  return { events, reporter: ev => { events.push(ev); } };
}

describe('user-config-loader — loadUserBindings', () => {
  test('missing file → missing event + empty report', () => {
    const { events, reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.loaded).toBe(0);
    expect(r.skipped).toHaveLength(0);
    expect(events.some(e => e.kind === 'missing')).toBe(true);
    expect(listAllBindings()).toHaveLength(0);
  });

  test('valid bindings apply to the user-config layer', () => {
    write({
      version: 1,
      bindings: [
        { matcher: 'alt+s', actionId: 'mode.enter.sync' },
        { matcher: 'ctrl+b y', actionId: 'mode.enter.sync', context: 'input' },
      ],
    });
    const { events, reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.loaded).toBe(2);
    expect(r.skipped).toHaveLength(0);
    const all = listAllBindings();
    expect(all.every(b => b.source === 'user-config')).toBe(true);
    expect(all.some(b => b.matcher === 'alt+s')).toBe(true);
    expect(all.some(b => b.matcher === 'ctrl+b y' && b.context === 'input')).toBe(true);
    expect(events.some(e => e.kind === 'loaded')).toBe(true);
  });

  test('reserved-key entry is skipped with reason', () => {
    write({
      version: 1,
      bindings: [
        { matcher: 'alt+s', actionId: 'mode.enter.sync' },
        { matcher: 'ctrl+c', actionId: 'custom.takeover' },
      ],
    });
    const { reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.loaded).toBe(1);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.reason).toContain('reserved');
    expect(listAllBindings().some(b => b.matcher === 'ctrl+c')).toBe(false);
  });

  test('reserved-action entry is skipped', () => {
    write({
      version: 1,
      bindings: [
        { matcher: 'ctrl+x', actionId: 'app.interrupt' },
      ],
    });
    const { reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.loaded).toBe(0);
    expect(r.skipped).toHaveLength(1);
  });

  test('malformed entry (non-string matcher) is skipped', () => {
    write({
      version: 1,
      bindings: [
        { matcher: 42, actionId: 'x' },
        { matcher: 'alt+s', actionId: '' },
        { matcher: 'alt+t', actionId: 'mode.enter.sync' },
      ],
    });
    const { reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.loaded).toBe(1);
    expect(r.skipped).toHaveLength(2);
  });

  test('malformed JSON does NOT wipe existing user-config overlay', () => {
    // Seed the overlay directly so we can observe that malformed
    // reload keeps the prior bindings.
    setUserConfigBindings([{ matcher: 'alt+x', actionId: 'x.seed' }]);
    write('{ not valid json');
    const { events, reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.loaded).toBe(0);
    expect(events.some(e => e.kind === 'malformed')).toBe(true);
    // Seed binding still present — malformed parse left it alone.
    expect(listAllBindings().some(b => b.matcher === 'alt+x')).toBe(true);
  });

  test('empty bindings array clears the overlay', () => {
    setUserConfigBindings([{ matcher: 'alt+x', actionId: 'x.seed' }]);
    write({ version: 1, bindings: [] });
    const { reporter } = capture();
    loadUserBindings(configPath, reporter);
    expect(listAllBindings()).toHaveLength(0);
  });

  test('matchers are lowercased on load', () => {
    write({
      version: 1,
      bindings: [
        { matcher: 'Alt+S', actionId: 'mode.enter.sync' },
      ],
    });
    const { reporter } = capture();
    loadUserBindings(configPath, reporter);
    expect(listAllBindings()[0]!.matcher).toBe('alt+s');
  });
});

describe('R5 — binding conflict detection', () => {
  test('user-config overrides default → conflict recorded', () => {
    addDefaultBinding({ matcher: 'ctrl+b s', actionId: 'mode.enter.sync' });
    write({
      version: 1,
      bindings: [
        { matcher: 'ctrl+b s', actionId: 'custom.user.override' },
      ],
    });
    const { reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.loaded).toBe(1);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]!.matcher).toBe('ctrl+b s');
    expect(r.conflicts[0]!.defaultActionId).toBe('mode.enter.sync');
    expect(r.conflicts[0]!.newActionId).toBe('custom.user.override');
  });

  test('redundant re-binding (same actionId) is NOT a conflict', () => {
    addDefaultBinding({ matcher: 'ctrl+b s', actionId: 'mode.enter.sync' });
    write({
      version: 1,
      bindings: [
        { matcher: 'ctrl+b s', actionId: 'mode.enter.sync' },
      ],
    });
    const { reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.loaded).toBe(1);
    expect(r.conflicts).toHaveLength(0);
  });

  test('new matcher (no default) is not a conflict', () => {
    write({
      version: 1,
      bindings: [
        { matcher: 'alt+x', actionId: 'x.fresh' },
      ],
    });
    const { reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.conflicts).toHaveLength(0);
  });
});

describe('R6 — settings block (chordWindowMs)', () => {
  test('valid chordWindowMs is applied', () => {
    write({ version: 1, bindings: [], settings: { chordWindowMs: 350 } });
    const { reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.settings.applied.chordWindowMs).toBe(350);
    expect(r.settings.rejected).toHaveLength(0);
    expect(getInputSettings().chordWindowMs).toBe(350);
  });

  test('out-of-range chordWindowMs is rejected with reason', () => {
    write({ version: 1, bindings: [], settings: { chordWindowMs: 99999 } });
    const { reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.settings.applied).toEqual({});
    expect(r.settings.rejected).toHaveLength(1);
    expect(r.settings.rejected[0]!.reason).toContain('out of range');
    // Default preserved.
    expect(getInputSettings().chordWindowMs).toBe(700);
  });

  test('non-numeric chordWindowMs is rejected', () => {
    write({ version: 1, bindings: [], settings: { chordWindowMs: 'fast' } });
    const { reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.settings.rejected[0]!.reason).toContain('number');
  });

  test('missing settings block uses defaults', () => {
    write({ version: 1, bindings: [{ matcher: 'alt+s', actionId: 'x' }] });
    const { reporter } = capture();
    loadUserBindings(configPath, reporter);
    expect(getInputSettings().chordWindowMs).toBe(700);
  });

  test('settings reset to defaults BEFORE applying new values (so removed knobs revert)', () => {
    // First load sets chordWindowMs to 200.
    write({ version: 1, bindings: [], settings: { chordWindowMs: 200 } });
    const { reporter } = capture();
    loadUserBindings(configPath, reporter);
    expect(getInputSettings().chordWindowMs).toBe(200);
    // Second load drops the settings block → revert to default.
    write({ version: 1, bindings: [] });
    loadUserBindings(configPath, reporter);
    expect(getInputSettings().chordWindowMs).toBe(700);
  });
});

describe('R8 — schema version', () => {
  test('supported version loads normally', () => {
    write({ version: 1, bindings: [{ matcher: 'alt+s', actionId: 'x' }] });
    const { reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.version).toBe(1);
    expect(r.loaded).toBe(1);
  });

  test('future version → version-mismatch event + overlay preserved', () => {
    setUserConfigBindings([{ matcher: 'alt+x', actionId: 'x.seed' }]);
    write({ version: 2, bindings: [] });
    const { events, reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.loaded).toBe(0);
    expect(r.version).toBe(2);
    expect(events.some(e => e.kind === 'version-mismatch')).toBe(true);
    // Prior overlay still active (not cleared).
    expect(listAllBindings().some(b => b.matcher === 'alt+x')).toBe(true);
  });

  test('missing version → version-mismatch (treat as unknown)', () => {
    write({ bindings: [{ matcher: 'alt+s', actionId: 'x' }] });
    const { events, reporter } = capture();
    const r = loadUserBindings(configPath, reporter);
    expect(r.loaded).toBe(0);
    expect(r.version).toBe('unknown');
    expect(events.some(e => e.kind === 'version-mismatch')).toBe(true);
  });
});
