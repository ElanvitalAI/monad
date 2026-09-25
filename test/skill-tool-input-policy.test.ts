import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  dispatchSetInputMode,
  dispatchGetInputPolicy,
  dispatchSetInputBinding,
} from '../src/skills/tools/input-policy.js';
import {
  registerBuiltInModes,
  registerAction,
  addDefaultBinding,
  setUserConfigBindings,
  listAllBindings,
  activeMode,
  __resetModeManagerForTests,
  __resetActionRegistryForTests,
  __resetBindingsForTests,
  __resetContextForTests,
} from '../src/input-core/index.js';
import { setControlAuditSinkForTesting } from '../src/control-audit-log.js';

let auditEvents: Array<{ action: string; subject?: string; ok: boolean; detail?: unknown }> = [];

beforeEach(() => {
  __resetModeManagerForTests();
  __resetActionRegistryForTests();
  __resetBindingsForTests();
  __resetContextForTests();
  auditEvents = [];
  setControlAuditSinkForTesting(ev => auditEvents.push(ev));
});

afterEach(() => {
  __resetModeManagerForTests();
  __resetActionRegistryForTests();
  __resetBindingsForTests();
  __resetContextForTests();
  setControlAuditSinkForTesting(null);
});

describe('SetInputMode tool', () => {
  test('switches mode + records audit', async () => {
    registerBuiltInModes();
    const r = await dispatchSetInputMode({ mode: 'control' });
    expect(r.activeMode).toBe('control');
    expect(r.previousMode).toBe('general');
    expect(r.output).toContain('general → control');
    expect(auditEvents.some(e => e.action === 'input_set_mode' && e.ok && e.subject === 'control')).toBe(true);
  });

  test('unknown mode returns explanatory output, no state change', async () => {
    registerBuiltInModes();
    const r = await dispatchSetInputMode({ mode: 'bogus' });
    expect(r.activeMode).toBe('general');
    expect(r.output).toContain('unknown mode');
  });

  test('same-mode is a no-op', async () => {
    registerBuiltInModes();
    const r = await dispatchSetInputMode({ mode: 'general' });
    expect(r.activeMode).toBe('general');
    expect(r.previousMode).toBe('general');
  });
});

describe('GetInputPolicy tool', () => {
  test('returns snapshot with bindings + actions + reserved + context', async () => {
    registerBuiltInModes();
    registerAction({ id: 'x.ping', handler: () => {}, description: 'demo' });
    addDefaultBinding({ matcher: 'ctrl+p', actionId: 'x.ping' });
    setUserConfigBindings([{ matcher: 'ctrl+k', actionId: 'x.ping' }]);
    const r = await dispatchGetInputPolicy({});
    expect(r.activeMode).toBe('general');
    expect(r.mode.map(m => m.id).sort()).toEqual(['control', 'general']);
    expect(r.bindings.some(b => b.matcher === 'ctrl+p' && b.source === 'default')).toBe(true);
    expect(r.bindings.some(b => b.matcher === 'ctrl+k' && b.source === 'user-config')).toBe(true);
    expect(r.actions.some(a => a.id === 'x.ping')).toBe(true);
    expect(r.reservedKeys).toContain('ctrl+c');
    expect(r.reservedKeys).toContain('escape');
    expect(r.reservedActionIds).toContain('app.interrupt');
    expect(r.output).toContain('mode=general');
  });
});

describe('SetInputBinding tool', () => {
  test('successfully adds a runtime binding', async () => {
    registerAction({ id: 'x.target', handler: () => {} });
    const r = await dispatchSetInputBinding({
      actionId: 'x.target',
      keys: ['alt+t'],
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('x.target');
    expect(listAllBindings().some(b => b.actionId === 'x.target' && b.source === 'runtime')).toBe(true);
    expect(auditEvents.some(e => e.action === 'input_set_binding' && e.ok)).toBe(true);
  });

  test('rejects reserved key with ReservationViolation', async () => {
    const r = await dispatchSetInputBinding({
      actionId: 'x.takeover',
      keys: ['ctrl+c'],
    });
    expect(r.ok).toBe(false);
    expect(r.violation?.kind).toBe('reserved-key');
    expect(r.violation?.value).toBe('ctrl+c');
    expect(r.output).toContain('reserved');
    // Audit records the violation.
    expect(auditEvents.some(e => e.action === 'input_set_binding' && !e.ok)).toBe(true);
  });

  test('rejects reserved action id', async () => {
    const r = await dispatchSetInputBinding({
      actionId: 'app.interrupt',
      keys: ['ctrl+x'],
    });
    expect(r.ok).toBe(false);
    expect(r.violation?.kind).toBe('reserved-action');
  });

  test('empty keys array clears the runtime binding', async () => {
    registerAction({ id: 'x.target', handler: () => {} });
    await dispatchSetInputBinding({ actionId: 'x.target', keys: ['alt+t'] });
    expect(listAllBindings().some(b => b.actionId === 'x.target')).toBe(true);
    const r = await dispatchSetInputBinding({ actionId: 'x.target', keys: [] });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('cleared');
    expect(listAllBindings().some(b => b.actionId === 'x.target')).toBe(false);
    expect(auditEvents.some(e => e.action === 'input_clear_binding' && e.ok)).toBe(true);
  });

  test('missing actionId returns error', async () => {
    const r = await dispatchSetInputBinding({ keys: ['alt+t'] });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('actionId');
  });

  test('context-scoped binding records context in output', async () => {
    registerAction({ id: 'x.scoped', handler: () => {} });
    const r = await dispatchSetInputBinding({
      actionId: 'x.scoped',
      keys: ['alt+s'],
      context: 'control-mode',
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('control-mode');
  });
});
