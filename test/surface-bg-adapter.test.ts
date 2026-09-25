// ── IUL Bundle 4T Phase 2 — bg-surface-adapter tests ──

import { describe, expect, test } from 'bun:test';
import {
  registerBackgroundHandle,
  unregisterBackgroundHandle,
  bindBackgroundSurfaceToRegistry,
  createSurfaceRegistry,
  type BackgroundSurfaceLike,
  type BgRollupLike,
} from '../src/surface/index.js';

function fakeBgSurface(initial: BgRollupLike | null) {
  let snap = initial;
  let detached = 0;
  return {
    surface: {
      latest: () => snap,
      detach: () => { detached++; },
    } as BackgroundSurfaceLike,
    set(next: BgRollupLike | null) { snap = next; },
    get detached() { return detached; },
  };
}

describe('bg-surface-adapter', () => {
  test('registerBackgroundHandle adds {kind:bg} entry', () => {
    const reg = createSurfaceRegistry();
    registerBackgroundHandle({ registry: reg, bgId: 'sh-1', title: 'npm watch' });
    const d = reg.get({ kind: 'bg', bgId: 'sh-1' });
    expect(d).toBeDefined();
    expect(d!.kindTag).toBe('shell-bg');
    expect(d!.tier).toBe('bg');
    expect(d!.title).toBe('npm watch');
  });

  test('unregister returns true/false', () => {
    const reg = createSurfaceRegistry();
    registerBackgroundHandle({ registry: reg, bgId: 'a' });
    expect(unregisterBackgroundHandle('a', reg)).toBe(true);
    expect(unregisterBackgroundHandle('a', reg)).toBe(false);
  });

  test('bind syncNow registers per-handle entries from rollup', () => {
    const reg = createSurfaceRegistry();
    const fb = fakeBgSurface({
      entries: [
        { id: 'h1', status: 'running', label: 'first' },
        { id: 'h2', status: 'running', label: 'second' },
      ],
    });
    const handle = bindBackgroundSurfaceToRegistry(fb.surface, { registry: reg });
    expect(handle.syncNow()).toBe(2);
    expect(reg.listByKind('bg')).toHaveLength(2);
    expect(reg.get({ kind: 'bg', bgId: 'h1' })!.title).toBe('first');
    expect(reg.get({ kind: 'bg', bgId: 'h2' })!.title).toBe('second');
  });

  test('bind syncNow drops entries that disappeared from rollup', () => {
    const reg = createSurfaceRegistry();
    const fb = fakeBgSurface({
      entries: [
        { id: 'h1', status: 'running' },
        { id: 'h2', status: 'running' },
      ],
    });
    const handle = bindBackgroundSurfaceToRegistry(fb.surface, { registry: reg });
    handle.syncNow();
    fb.set({ entries: [{ id: 'h1', status: 'running' }] });
    handle.syncNow();
    expect(reg.listByKind('bg')).toHaveLength(1);
    expect(reg.get({ kind: 'bg', bgId: 'h2' })).toBeUndefined();
  });

  test('completed/killed entries register with visible=false', () => {
    const reg = createSurfaceRegistry();
    const fb = fakeBgSurface({
      entries: [
        { id: 'done', status: 'completed' },
        { id: 'live', status: 'running' },
      ],
    });
    const handle = bindBackgroundSurfaceToRegistry(fb.surface, { registry: reg });
    handle.syncNow();
    expect(reg.get({ kind: 'bg', bgId: 'done' })!.visible).toBe(false);
    expect(reg.get({ kind: 'bg', bgId: 'live' })!.visible).toBe(true);
  });

  test('rollupId option creates a synthetic rollup entry', () => {
    const reg = createSurfaceRegistry();
    const fb = fakeBgSurface({
      entries: [
        { id: 'h1', status: 'running' },
        { id: 'h2', status: 'running' },
      ],
    });
    const handle = bindBackgroundSurfaceToRegistry(fb.surface, {
      registry: reg,
      rollupId: '__rollup__',
    });
    handle.syncNow();
    const rollup = reg.get({ kind: 'bg', bgId: '__rollup__' });
    expect(rollup).toBeDefined();
    expect(rollup!.kindTag).toBe('shell-bg-rollup');
    expect(rollup!.title).toBe('bg-rollup(2)');
    // 2 handles + 1 rollup = 3 entries
    expect(reg.listByKind('bg')).toHaveLength(3);
  });

  test('dispose clears all owned entries + detaches surface', () => {
    const reg = createSurfaceRegistry();
    const fb = fakeBgSurface({
      entries: [
        { id: 'h1', status: 'running' },
        { id: 'h2', status: 'running' },
      ],
    });
    const handle = bindBackgroundSurfaceToRegistry(fb.surface, { registry: reg });
    handle.syncNow();
    expect(reg.listByKind('bg')).toHaveLength(2);
    handle.dispose();
    expect(reg.listByKind('bg')).toHaveLength(0);
    expect(fb.detached).toBe(1);
  });

  test('null latest snapshot is a no-op', () => {
    const reg = createSurfaceRegistry();
    const fb = fakeBgSurface(null);
    const handle = bindBackgroundSurfaceToRegistry(fb.surface, { registry: reg });
    expect(handle.syncNow()).toBe(0);
    expect(reg.listByKind('bg')).toHaveLength(0);
  });
});
