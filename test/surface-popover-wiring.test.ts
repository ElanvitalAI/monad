// ── VW-term-infra Bundle A · A2 — popover-wiring unit tests ──
//
// Uses a fresh `createSurfaceRegistry()` so the module-level singleton
// stays untouched between tests. Covers open/close/re-open,
// idempotent unregister, and LLM-surface observability (kind filter +
// ObserveSurface event window).

import { afterEach, describe, expect, test } from 'bun:test';

import { createPopoverRegistrar } from '../src/surface/adapters/popover-wiring.js';
import { createSurfaceRegistry } from '../src/surface/registry.js';
import { dispatchGetUIState, dispatchObserveSurface } from '../src/surface/llm-tools.js';

const fresh = () => createSurfaceRegistry();

afterEach(() => { /* hermetic — each test owns its registry */ });

// ── Register / unregister core ──────────────────────────────────

describe('createPopoverRegistrar · core', () => {
  test('register → registry gets {kind:"popover"} entry', () => {
    const reg = fresh();
    const registrar = createPopoverRegistrar({ registry: reg });
    const id = registrar.register('workingDir', { kindTag: 'wd-picker' });
    const list = reg.list().filter(d => d.addr.kind === 'popover');
    expect(list).toHaveLength(1);
    expect(list[0]!.kindTag).toBe('wd-picker');
    expect(id.startsWith('popover-of-')).toBe(true);
  });

  test('unregister removes entry · returns true first time, false after', () => {
    const reg = fresh();
    const registrar = createPopoverRegistrar({ registry: reg });
    const id = registrar.register('mode');
    expect(registrar.unregister(id)).toBe(true);
    expect(registrar.unregister(id)).toBe(false);
    expect(reg.list().filter(d => d.addr.kind === 'popover')).toHaveLength(0);
  });

  test('register twice same anchor → single active entry (idempotent re-open)', () => {
    const reg = fresh();
    const registrar = createPopoverRegistrar({ registry: reg });
    registrar.register('workingDir');
    registrar.register('workingDir', { title: 'updated' });
    const list = reg.list().filter(d => d.addr.kind === 'popover');
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('updated');
    expect(registrar.list()).toEqual(['popover-of-workingDir']);
  });

  test('register two different anchors → two entries', () => {
    const reg = fresh();
    const registrar = createPopoverRegistrar({ registry: reg });
    registrar.register('workingDir');
    registrar.register('mode');
    expect(registrar.list()).toHaveLength(2);
    expect(reg.list().filter(d => d.addr.kind === 'popover')).toHaveLength(2);
  });
});

// ── LLM tool observability ──────────────────────────────────────

describe('createPopoverRegistrar · LLM tool surface', () => {
  test('GetUIState({kind:"popover"}) returns active popovers only', () => {
    const reg = fresh();
    const registrar = createPopoverRegistrar({ registry: reg });
    // Non-popover entry to ensure filter works.
    reg.register({ addr: { kind: 'modal', modalId: 'm1' }, kindTag: 'dialog' });
    registrar.register('workingDir', { kindTag: 'wd-picker' });
    const out = dispatchGetUIState({ kind: 'popover' }, { registry: reg });
    expect(out.surfaces).toHaveLength(1);
    expect(out.surfaces[0]!.kindTag).toBe('wd-picker');
  });

  test('ObserveSurface({kind:"popover"}) catches register + unregister', async () => {
    const reg = fresh();
    const registrar = createPopoverRegistrar({ registry: reg });
    const obsPromise = dispatchObserveSurface(
      { kind: 'popover', durationMs: 30 },
      { registry: reg },
    );
    const id = registrar.register('mode');
    registrar.unregister(id);
    const out = await obsPromise;
    const kinds = out.events.map(e => e.kind).sort();
    expect(kinds).toEqual(['register', 'unregister']);
  });
});

// ── Non-interference with modal path ────────────────────────────

describe('createPopoverRegistrar · non-interference', () => {
  test('modal entries unaffected · registrar only adds popover entries', () => {
    const reg = fresh();
    const registrar = createPopoverRegistrar({ registry: reg });
    reg.register({ addr: { kind: 'modal', modalId: 'dlg-1' }, kindTag: 'dialog' });
    registrar.register('workingDir');
    const modals = reg.list().filter(d => d.addr.kind === 'modal');
    const popovers = reg.list().filter(d => d.addr.kind === 'popover');
    expect(modals).toHaveLength(1);
    expect(popovers).toHaveLength(1);
  });

  test('list() reflects only what registrar itself tracks', () => {
    const reg = fresh();
    const registrar = createPopoverRegistrar({ registry: reg });
    registrar.register('a');
    registrar.register('b');
    expect(new Set(registrar.list())).toEqual(
      new Set(['popover-of-a', 'popover-of-b']),
    );
    registrar.unregister('popover-of-a');
    expect(registrar.list()).toEqual(['popover-of-b']);
  });
});
